import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import {
  PostARBatchToDFOCommand,
  PostARBatchToDFOResult,
} from '@/modules/accounts-receivable/commands';
import { DynAccountReceivableLineModel } from '@/modules/accounts-receivable/models';
import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(PostARBatchToDFOCommand)
@Injectable()
export class PostARBatchToDFOHandler implements ICommandHandler<
  PostARBatchToDFOCommand,
  PostARBatchToDFOResult
> {
  private readonly logger = new Logger(PostARBatchToDFOHandler.name);
  /**
   * When enabled, we only enqueue a small sample payload:
   * - 1 invoice header
   * - up to 10 related lines
   */
  private readonly testingModeEnabled = process.env.NODE_ENV === 'development';
  private readonly testingModeMaxLines = 10;

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: PostARBatchToDFOCommand,
  ): Promise<PostARBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Starting post to DFO for batch ${batchId}`);

    const batch = await this.validateBatch(batchId);

    const invoiceGroups = await this.groupRecordsByFreeTextNumber(batchId);

    const groupedInvoices = this.mapToD365FORequests(
      invoiceGroups,
      batch.company,
    );

    const invoicesToQueue = this.applyTestingMode(groupedInvoices);
    this.validateInvoices(invoicesToQueue);

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(
      batchId,
      batch.company,
      invoicesToQueue,
    );
  }

  /**
   * Validates that the batch exists
   */
  private async validateBatch(batchId: string) {
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    return batch;
  }

  /**
   * Groups enhanced records by FreeTextNumber using cursor streaming (memory-efficient)
   */
  private async groupRecordsByFreeTextNumber(
    batchId: string,
  ): Promise<
    Map<string, IDataEnhancedRecord<DynAccountReceivableLineModel>[]>
  > {
    const cursor = this.dataBatchService.getEnhancedRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    const invoiceGroups = new Map<
      string,
      IDataEnhancedRecord<DynAccountReceivableLineModel>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as DynAccountReceivableLineModel;

      if (!this.isValidRecord(data, record.id)) {
        continue;
      }

      const freeTextNumber = data.FreeTextNumber;
      if (!invoiceGroups.has(freeTextNumber)) {
        invoiceGroups.set(freeTextNumber, []);
      }

      invoiceGroups
        .get(freeTextNumber)!
        .push(
          record as unknown as IDataEnhancedRecord<DynAccountReceivableLineModel>,
        );
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Grouped ${recordCount} records into ${invoiceGroups.size} invoices`,
    );

    return invoiceGroups;
  }

  /**
   * Checks if a record is valid for processing
   */
  private isValidRecord(
    data: DynAccountReceivableLineModel,
    recordId: string,
  ): data is DynAccountReceivableLineModel {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const lineDto = data;
    if (!lineDto.FreeTextNumber) {
      this.logger.warn(`Skipping record ${recordId}: missing FreeTextNumber`);
      return false;
    }

    return true;
  }

  /**
   * Maps grouped records to D365FO request types
   */
  private mapToD365FORequests(
    invoiceGroups: Map<
      string,
      IDataEnhancedRecord<DynAccountReceivableLineModel>[]
    >,
    company: string,
  ): Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
    HeaderDefaultDimensionDisplayValue: string;
    LineFinTagDisplayValues: string[];
  }> {
    const groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
      HeaderDefaultDimensionDisplayValue: string;
      LineFinTagDisplayValues: string[];
    }> = [];

    for (const [_freeTextNumber, lines] of invoiceGroups.entries()) {
      if (lines.length === 0) continue;

      const header = this.mapHeaderFromLine(lines[0].data, company);
      const mappedLines = this.mapLines(lines, company);
      const headerDefaultDimensionDisplayValue =
        lines[0].data.HeaderDefaultDimensionDisplayValue;
      const lineFinTagDisplayValues = lines.map(
        (line) => line.data.LineFinTagDisplayValue || '',
      );

      groupedInvoices.push({
        header,
        lines: mappedLines,
        HeaderDefaultDimensionDisplayValue: headerDefaultDimensionDisplayValue,
        LineFinTagDisplayValues: lineFinTagDisplayValues,
      });
    }

    return groupedInvoices;
  }

  private applyTestingMode(
    groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
      HeaderDefaultDimensionDisplayValue: string;
      LineFinTagDisplayValues: string[];
    }>,
  ): Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
    HeaderDefaultDimensionDisplayValue: string;
    LineFinTagDisplayValues: string[];
  }> {
    if (!this.testingModeEnabled) {
      return groupedInvoices;
    }

    const first = groupedInvoices[0];
    if (!first) {
      return groupedInvoices;
    }

    const limited = {
      header: first.header,
      lines: first.lines.slice(0, this.testingModeMaxLines),
      HeaderDefaultDimensionDisplayValue:
        first.HeaderDefaultDimensionDisplayValue,
      LineFinTagDisplayValues: first.LineFinTagDisplayValues.slice(
        0,
        this.testingModeMaxLines,
      ),
    };

    this.logger.warn(
      `DFO free-text invoice TEST MODE enabled: enqueueing 1 header and ${limited.lines.length} lines (max ${this.testingModeMaxLines})`,
    );
    this.logger.log(
      `TEST MODE payload - header: ${JSON.stringify(limited.header, null, 2)}`,
    );
    this.logger.log(
      `TEST MODE payload - lines: ${JSON.stringify(limited.lines, null, 2)}`,
    );

    return [limited];
  }

  /**
   * Maps the first line of an invoice group to a header request
   */
  private mapHeaderFromLine(
    firstLine: DynAccountReceivableLineModel,
    company: string,
  ): D365FOFreeTextInvoiceHeaderRequest {
    return {
      dataAreaId: company,
      InvoiceAccount: firstLine.InvoiceAccount,
      CustomerAccount: firstLine.CustomerAccount,
      DocumentDate: this.formatDate(firstLine.DocumentDate),
      InvoiceDate: this.formatDate(firstLine.InvoiceDate),
      DueDate: this.formatDate(firstLine.DueDate),
      CurrencyCode: firstLine.CurrencyCode,
      TermsOfPayment: firstLine.TermsOfPayment,
      BillingClassification: firstLine.BillingClassification,
      CustomerReference: firstLine.CustomerReference,
      DefaultDimensionDisplayValue:
        firstLine.HeaderDefaultDimensionDisplayValue,
      PostingProfile: firstLine.PostingProfile,
      SalesTaxGroupId: firstLine.SalesTaxGroup,
      SalesTaxItemGroupId: firstLine.SalesTaxItemGroup,
      EInvoiceIsLineSpecific: firstLine.EInvoiceIsLineSpecific,
      OverrideSalesTax: firstLine.OverrideSalesTax,
      InclTax: firstLine.InclTax,
      LanguageId: 'en-US',
    };
  }

  /**
   * Maps invoice lines to D365FO line requests
   */
  private mapLines(
    lines: IDataEnhancedRecord<DynAccountReceivableLineModel>[],
    company: string,
  ): D365FOFreeTextInvoiceLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;
      return {
        dataAreaId: company,
        LineNumber: line.LineNumber || 0,
        ParentRecId: 0, // Will be set in queue processor after header is created
        BillingCode: line.BillingCode,
        Description: line.Description,
        MainAccountDisplayValue: line.LedgerDimensionDisplayValue,
        CurrencyCode: line.CurrencyCode,
        UnitPrice: line.UnitPrice,
        DefaultDimensionDisplayValue: line.DefaultDimensionDisplayValue,
        Quantity: line.Quantity,
        SalesTaxGroupId: line.SalesTaxGroup,
        SalesTaxItemGroupId: line.SalesTaxItemGroup,
        InvoiceText: line.InvoiceTxt,
        OverrideSalesTax: line.OverrideSalesTax,
        EInvoiceAccountCode: line.EInvoiceAccountCode,
      };
    });
  }

  /**
   * Validates that all invoices have required header and line fields
   */
  private validateInvoices(
    groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
      HeaderDefaultDimensionDisplayValue: string;
      LineFinTagDisplayValues: string[];
    }>,
  ): void {
    const validationErrors: Array<{
      invoiceIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }> = [];

    groupedInvoices.forEach((invoice, invoiceIndex) => {
      // Validate header
      const headerErrors = this.validateHeader(invoice.header);
      if (headerErrors.length > 0) {
        validationErrors.push({
          invoiceIndex,
          missingFields: headerErrors,
        });
      }

      // Validate lines
      invoice.lines.forEach((line) => {
        const lineErrors = this.validateLine(
          line,
          invoice.header.BillingClassification,
        );
        if (lineErrors.length > 0) {
          validationErrors.push({
            invoiceIndex,
            lineNumber: line.LineNumber,
            missingFields: lineErrors,
          });
        }
      });
    });

    if (validationErrors.length > 0) {
      const errorMessages = validationErrors.map((error) => {
        if (error.lineNumber !== undefined) {
          return `Line ${error.lineNumber}: missing fields [${error.missingFields.join(', ')}]`;
        }
        return `Invoice header (index ${error.invoiceIndex}): missing fields [${error.missingFields.join(', ')}]`;
      });

      throw new BadRequestException({
        message: 'Validation failed for invoice data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  /**
   * Validates header fields and returns array of missing field names
   */
  private validateHeader(header: D365FOFreeTextInvoiceHeaderRequest): string[] {
    const missingFields: string[] = [];

    // Required fields - check for empty strings as well
    if (!header.DefaultDimensionDisplayValue?.trim()) {
      missingFields.push('DefaultDimensionDisplayValue');
    }
    if (!header.PostingProfile?.trim()) {
      missingFields.push('PostingProfile');
    }
    if (!header.InvoiceAccount?.trim()) {
      missingFields.push('InvoiceAccount');
    }
    if (!header.CustomerAccount?.trim()) {
      missingFields.push('CustomerAccount');
    }
    if (!header.SalesTaxGroupId?.trim()) {
      missingFields.push('SalesTaxGroupId');
    }
    if (!header.TermsOfPayment?.trim()) {
      missingFields.push('TermsOfPayment');
    }
    if (!header.BillingClassification?.trim()) {
      missingFields.push('BillingClassification');
    }

    // SalesTaxItemGroupId is required only if SalesTaxGroupId is not "NonTaxable" or similar
    if (
      header.SalesTaxGroupId?.trim() &&
      !this.isNonTaxable(header.SalesTaxGroupId) &&
      !header.SalesTaxItemGroupId?.trim()
    ) {
      missingFields.push('SalesTaxItemGroupId');
    }

    return missingFields;
  }

  /**
   * Validates line fields and returns array of missing field names
   */
  private validateLine(
    line: D365FOFreeTextInvoiceLineRequest,
    _billingClassification: string,
  ): string[] {
    // const lowerBillingClassification = billingClassification?.toLowerCase();
    const missingFields: string[] = [];
    // const skippedDescriptionFields = ['inv-tr'];

    // Required fields - check for empty strings and null/undefined
    if (line.LineNumber === undefined || line.LineNumber === null) {
      missingFields.push('LineNumber');
    }
    if (!line.BillingCode?.trim()) {
      missingFields.push('BillingCode');
    }
    // if (
    //   !line.Description?.trim() &&
    //   !skippedDescriptionFields.includes(lowerBillingClassification)
    // ) {
    //   missingFields.push('Description');
    // }
    if (line.UnitPrice === undefined || line.UnitPrice === null) {
      missingFields.push('UnitPrice');
    }
    if (line.Quantity === undefined || line.Quantity === null) {
      missingFields.push('Quantity');
    }
    if (!line.MainAccountDisplayValue?.trim()) {
      missingFields.push('MainAccountDisplayValue');
    }
    if (!line.DefaultDimensionDisplayValue?.trim()) {
      missingFields.push('DefaultDimensionDisplayValue');
    }
    if (!line.SalesTaxGroupId?.trim()) {
      missingFields.push('SalesTaxGroupId');
    }

    // SalesTaxItemGroupId is required only if SalesTaxGroupId is not "NonTaxable" or similar
    if (
      line.SalesTaxGroupId?.trim() &&
      !this.isNonTaxable(line.SalesTaxGroupId) &&
      !line.SalesTaxItemGroupId?.trim()
    ) {
      missingFields.push('SalesTaxItemGroupId');
    }

    return missingFields;
  }

  /**
   * Checks if a sales tax group is non-taxable
   */
  private isNonTaxable(salesTaxGroupId: string): boolean {
    if (!salesTaxGroupId) return false;
    const lower = salesTaxGroupId.toLowerCase();
    return (
      lower.includes('non') ||
      lower.includes('exempt') ||
      lower === 'nontaxable' ||
      lower === 'non-taxable'
    );
  }

  /**
   * Prepares batch for posting by updating status and clearing errors
   */
  private async prepareBatchForPosting(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Processing,
      ),
      this.dataBatchService.clearDfoPostingErrorsAsync(batchId),
    ]);
  }

  /**
   * Enqueues the posting job and returns the result
   */
  private async enqueuePostingJob(
    batchId: string,
    company: string,
    groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
      HeaderDefaultDimensionDisplayValue: string;
      LineFinTagDisplayValues: string[];
    }>,
  ): Promise<PostARBatchToDFOResult> {
    const job = await this.queueService.addJob(
      QUEUES.DFO_FREE_TEXT_INVOICE,
      'post-free-text-invoice-batch-to-dfo',
      {
        batchId,
        company,
        groupedInvoices,
        sourceModule: 'AR',
      },
    );

    this.logger.log(
      `Enqueued job ${job.id} for batch ${batchId} with ${groupedInvoices.length} invoices`,
    );

    return {
      jobId: job.id!,
      message: `Batch ${batchId} queued for posting to D365FO. Job ID: ${job.id}`,
    };
  }

  /**
   * Converts MongoDB cursor to async iterable
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataEnhancedRecord> {
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          dimensionModel: doc.dimensionModel,
          sourceIds: doc.sourceIds || [],
          data: doc.data,
          dataModelType: doc.dataModelType,
        };
      }
    } finally {
      // Ensure cursor is closed
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {
          // Ignore errors on close
        });
      }
    }
  }

  /**
   * Format date to ISO string
   */
  private formatDate(date?: Date | string): string {
    if (!date) {
      throw new Error('Date is required');
    }
    if (date instanceof Date) {
      return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
    if (typeof date === 'string') {
      // Try to parse and format
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date format: ${date}`);
      }
      return parsed.toISOString().split('T')[0];
    }
    throw new Error(`Invalid date type: ${typeof date}`);
  }
}
