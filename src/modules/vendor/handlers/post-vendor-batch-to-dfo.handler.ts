import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';
import {
  PostVendorBatchToDFOCommand,
  PostVendorBatchToDFOResult,
} from '@/modules/vendor/commands';
import { VendorFreightDFOLine } from '@/modules/vendor/interfaces';

@CommandHandler(PostVendorBatchToDFOCommand)
@Injectable()
export class PostVendorBatchToDFOHandler implements ICommandHandler<
  PostVendorBatchToDFOCommand,
  PostVendorBatchToDFOResult
> {
  private readonly logger = new Logger(PostVendorBatchToDFOHandler.name);
  /**
   * When enabled, we only enqueue a small sample payload:
   * - 1 journal header
   * - up to 10 related lines
   */
  private readonly testingModeEnabled = process.env.NODE_ENV === 'development';
  private readonly testingModeMaxLines = 10;

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: PostVendorBatchToDFOCommand,
  ): Promise<PostVendorBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Starting post to DFO for vendor batch ${batchId}`);

    const batch = await this.validateBatch(batchId);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

    const groupedJournals = this.mapToD365FORequests(
      journalGroups,
      batch.company,
    );

    const journalsToQueue = this.applyTestingMode(groupedJournals);
    this.validateJournals(journalsToQueue);

    // console.log(JSON.stringify(journalsToQueue, null, 2));
    // return {
    //   jobId: '123',
    //   message: 'Batch 123 queued for posting to D365FO. Job ID: 123',
    // };

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(
      batchId,
      batch.company,
      journalsToQueue,
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
   * Groups enhanced records by JOURNALBATCHNUMBER using cursor streaming (memory-efficient)
   */
  private async groupRecordsByJournalBatchNumber(
    batchId: string,
  ): Promise<Map<string, IDataEnhancedRecord<VendorFreightDFOLine>[]>> {
    const cursor = this.dataBatchService.getEnhancedRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    const journalGroups = new Map<
      string,
      IDataEnhancedRecord<VendorFreightDFOLine>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as VendorFreightDFOLine;

      if (!this.isValidRecord(data, record.id)) {
        continue;
      }

      const journalBatchNumber = data.JOURNALBATCHNUMBER;
      if (!journalGroups.has(journalBatchNumber)) {
        journalGroups.set(journalBatchNumber, []);
      }

      journalGroups
        .get(journalBatchNumber)!
        .push(record as unknown as IDataEnhancedRecord<VendorFreightDFOLine>);
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Grouped ${recordCount} records into ${journalGroups.size} journal batches`,
    );

    return journalGroups;
  }

  /**
   * Checks if a record is valid for processing
   */
  private isValidRecord(
    data: VendorFreightDFOLine,
    recordId: string,
  ): data is VendorFreightDFOLine {
    if (!data || typeof data !== 'object') {
      return false;
    }

    if (!data.JOURNALBATCHNUMBER) {
      this.logger.warn(
        `Skipping record ${recordId}: missing JOURNALBATCHNUMBER`,
      );
      return false;
    }

    return true;
  }

  /**
   * Maps grouped records to D365FO request types
   */
  private mapToD365FORequests(
    journalGroups: Map<string, IDataEnhancedRecord<VendorFreightDFOLine>[]>,
    company: string,
  ): Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }> {
    const groupedJournals: Array<{
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }> = [];

    for (const [_journalBatchNumber, lines] of journalGroups.entries()) {
      if (lines.length === 0) continue;

      const header = this.mapHeaderFromLines(lines, company);
      const mappedLines = this.mapLines(lines, company);

      groupedJournals.push({ header, lines: mappedLines });
    }

    return groupedJournals;
  }

  /**
   * Maps the first line of a journal group to a header request
   */
  private mapHeaderFromLines(
    lines: IDataEnhancedRecord<VendorFreightDFOLine>[],
    company: string,
  ): D365FOVendorInvoiceJournalHeaderRequest {
    const firstLine = lines[0].data;
    const header = firstLine.header;

    // Header info comes from the header property on each line
    return {
      dataAreaId: company,
      JournalBatchNumber: header.JOURNALBATCHNUMBER,
      JournalName: header.JOURNALNAME,
      OverrideSalesTax: this.convertToYesNo(header.OVERRIDESALESTAX),
      Description: header.DESCRIPTION,
      SalesTaxIncluded: this.convertToYesNo(header.SALESTAXINCLUDED),
    };
  }

  /**
   * Maps journal lines to D365FO line requests.
   * For Ledger lines, D365FO expects AccountDisplayValue as full LedgerDimensionDisplayValue
   * (MainAccount|Dim1|Dim2|...) per the active Ledger dimension format.
   */
  private mapLines(
    lines: IDataEnhancedRecord<VendorFreightDFOLine>[],
    company: string,
  ): D365FOVendorInvoiceJournalLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;

      const accountDisplayValue =
        line.ACCOUNTTYPE === 'Ledger' &&
        line.DEFAULTDIMENSIONDISPLAYVALUE?.trim()
          ? line.ACCOUNTDISPLAYVALUE + line.DEFAULTDIMENSIONDISPLAYVALUE.trim()
          : line.ACCOUNTDISPLAYVALUE;

      return {
        dataAreaId: company,
        JournalBatchNumber: line.JOURNALBATCHNUMBER,
        LineNumber: line.LineNumber,
        AccountDisplayValue: accountDisplayValue,
        PostingProfile: line.POSTINGPROFILE,
        OffsetAccountDisplayValue: line.OFFSETACCOUNTDISPLAYVALUE,
        OffsetDefaultDimensionDisplayValue: this.toOptionalTrimmedString(
          line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
        ),
        DefaultDimensionDisplayValue: this.toOptionalTrimmedString(
          line.DEFAULTDIMENSIONDISPLAYVALUE,
        ),
        // FinTagDisplayValue / OffsetFinTagDisplayValue omitted: D365FO resolves them via
        // FINTAGCREATEUNICODEHASH and FINTAGDATAENTITYSFKCACHE; if that SQL function is
        // missing or misconfigured, posting fails. Omit to allow lines to post.
        FinTagDisplayValue: line.FINTAGDISPLAYVALUE,
        OffsetFinTagDisplayValue: line.OFFSETFINTAGDISPLAYVALUE,
        ReportingCurrencyExchRate: line.REPORTINGCURRENCYEXCHRATE,
        AccountType: line.ACCOUNTTYPE,
        TermsOfPayment: line.TERMSOFPAYMENT,
        ExchRateSecond: line.EXCHRATESECOND || 0,
        TransactionType: line.TRANSACTIONTYPE,
        MethodOfPayment: this.toOptionalTrimmedString(line.METHODOFPAYMENT),
        ExchRate: line.EXCHRATE ?? 1,
        Document: line.DOCUMENT ? String(line.DOCUMENT) : undefined,
        Description: this.toOptionalTrimmedString(line.DESCRIPTION),
        Invoice: line.INVOICE,
        Date: this.formatDate(line.DATE),
        Voucher: line.VOUCHER ? String(line.VOUCHER) : undefined,
        // TaxExemptNumber: this.toOptionalTrimmedString(line.TAXEXEMPTNUMBER),
        Currency: line.CURRENCY,
        ItemWithholdingTaxGroupCode: this.toOptionalTrimmedString(
          line.ITEMWITHHOLDINGTAXGROUPCODE,
        ),
        OffsetAccountType: line.OFFSETACCOUNTTYPE,
        InvoiceDate: line.INVOICEDATE
          ? this.formatDate(line.INVOICEDATE)
          : this.formatDate(line.DATE),
        Debit: line.DEBIT || 0,
        OffsetCompany: line.OFFSETCOMPANY,
        DueDate: line.DUEDATE ? this.formatDate(line.DUEDATE) : undefined,
        OverrideSalesTax: this.convertToYesNo(line.OVERRIDESALESTAX),
        SalesTaxGroup: this.toOptionalTrimmedString(line.SALESTAXGROUP),
        ItemSalesTaxGroup: this.toOptionalTrimmedString(line.ITEMSALESTAXGROUP),
        Credit: line.CREDIT || 0,
        Company: line.COMPANY || company,
      } as D365FOVendorInvoiceJournalLineRequest;
    });
  }

  private applyTestingMode(
    groupedJournals: Array<{
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }>,
  ): Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }> {
    if (!this.testingModeEnabled) {
      return groupedJournals;
    }

    const first = groupedJournals[0];
    if (!first) {
      return groupedJournals;
    }

    const limited = {
      header: {
        ...first.header,
        Description: `[TESTING_ONLY] ${first.header.Description ?? ''}`.trim(),
      },
      lines: first.lines.slice(0, this.testingModeMaxLines),
    };

    this.logger.warn(
      `DFO vendor journal TEST MODE enabled: enqueueing 1 header and ${limited.lines.length} lines (max ${this.testingModeMaxLines})`,
    );
    this.logger.log(
      `TEST MODE payload - header: ${JSON.stringify(limited.header, null, 2)}`,
    );
    this.logger.log(
      `TEST MODE payload - lines: ${JSON.stringify(limited.lines, null, 2)}`,
    );

    return [limited];
  }

  private toOptionalTrimmedString(
    value: string | undefined | null,
  ): string | undefined {
    if (value === null || value === undefined) return undefined;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Validates that all journals have required header and line fields
   */
  private validateJournals(
    groupedJournals: Array<{
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }>,
  ): void {
    const validationErrors: Array<{
      journalIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }> = [];

    groupedJournals.forEach((journal, journalIndex) => {
      // Validate header
      const headerErrors = this.validateHeader(journal.header);
      if (headerErrors.length > 0) {
        validationErrors.push({
          journalIndex,
          missingFields: headerErrors,
        });
      }

      // Validate lines
      journal.lines.forEach((line) => {
        const lineErrors = this.validateLine(line);
        if (lineErrors.length > 0) {
          validationErrors.push({
            journalIndex,
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
        return `Journal header (index ${error.journalIndex}): missing fields [${error.missingFields.join(', ')}]`;
      });

      throw new BadRequestException({
        message: 'Validation failed for journal data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  /**
   * Validates header fields and returns array of missing field names
   */
  private validateHeader(
    header: D365FOVendorInvoiceJournalHeaderRequest,
  ): string[] {
    const missingFields: string[] = [];

    if (!header.dataAreaId?.trim()) {
      missingFields.push('dataAreaId');
    }
    if (!header.JournalBatchNumber?.trim()) {
      missingFields.push('JournalBatchNumber');
    }
    if (!header.JournalName?.trim()) {
      missingFields.push('JournalName');
    }
    if (
      !header.OverrideSalesTax ||
      !['Yes', 'No'].includes(header.OverrideSalesTax)
    ) {
      missingFields.push('OverrideSalesTax');
    }
    if (!header.Description?.trim()) {
      missingFields.push('Description');
    }
    if (
      !header.SalesTaxIncluded ||
      !['Yes', 'No'].includes(header.SalesTaxIncluded)
    ) {
      missingFields.push('SalesTaxIncluded');
    }

    return missingFields;
  }

  /**
   * Validates line fields and returns array of missing field names
   * Based on the new payload structure with static and optional fields
   */
  private validateLine(line: D365FOVendorInvoiceJournalLineRequest): string[] {
    const missingFields: string[] = [];

    // Required fields
    if (!line.dataAreaId?.trim()) {
      missingFields.push('dataAreaId');
    }
    if (!line.JournalBatchNumber?.trim()) {
      missingFields.push('JournalBatchNumber');
    }
    if (line.LineNumber === undefined || line.LineNumber === null) {
      missingFields.push('LineNumber');
    }
    if (!line.AccountDisplayValue?.trim()) {
      missingFields.push('AccountDisplayValue');
    }
    // Static value - PostingProfile is required
    // if (!line.PostingProfile?.trim()) {
    //   missingFields.push('PostingProfile');
    // }
    if (!line.AccountType || !['Vend', 'Ledger'].includes(line.AccountType)) {
      missingFields.push('AccountType');
    }
    if (!line.Currency?.trim()) {
      missingFields.push('Currency');
    }
    if (!line.Date?.trim()) {
      missingFields.push('Date');
    }
    if (!line.InvoiceDate?.trim()) {
      missingFields.push('InvoiceDate');
    }
    if (!line.DueDate?.trim()) {
      missingFields.push('DueDate');
    }
    if (
      (line.Credit === undefined || line.Credit === null) &&
      (line.Debit === undefined || line.Debit === null)
    ) {
      missingFields.push('Credit or Debit');
    }
    if (line.Credit > 0 && line.Debit > 0) {
      missingFields.push('Credit and Debit cannot both be > 0');
    }
    if (line.ExchRate === undefined || line.ExchRate === null) {
      missingFields.push('ExchRate');
    }
    if (!line.TransactionType?.trim()) {
      missingFields.push('TransactionType');
    }
    if (
      !line.OverrideSalesTax ||
      !['Yes', 'No'].includes(line.OverrideSalesTax)
    ) {
      missingFields.push('OverrideSalesTax');
    }
    // if (!line.OffsetAccountType?.trim()) {
    //   missingFields.push('OffsetAccountType');
    // }
    // if (!line.OffsetAccountDisplayValue?.trim()) {
    //   missingFields.push('OffsetAccountDisplayValue');
    // }
    if (!line.OffsetCompany?.trim()) {
      missingFields.push('OffsetCompany');
    }
    // if (!line.DefaultDimensionDisplayValue?.trim()) {
    //   missingFields.push('DefaultDimensionDisplayValue');
    // }
    if (!line.Company?.trim()) {
      missingFields.push('Company');
    }
    if (!line.FinTagDisplayValue?.trim()) {
      missingFields.push('FinTagDisplayValue');
    }
    // Static value - ITMCostArea is required
    // if (!line.ITMCostArea?.trim()) {
    //   missingFields.push('ITMCostArea');
    // }

    // Optional fields are not validated (they can be empty/undefined):
    // - OffsetDefaultDimensionDisplayValue
    // - OffsetFinTagDisplayValue
    // - MethodOfPayment
    // - CashDiscount
    // - TaxExemptNumber
    // - ItemWithholdingTaxGroupCode
    // - ItemSalesTaxGroup
    // - SalesTaxCode
    // - SalesTaxGroup
    // - OffsetTransactionText

    return missingFields;
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
    groupedJournals: Array<{
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }>,
  ): Promise<PostVendorBatchToDFOResult> {
    const job = await this.queueService.addJob(
      QUEUES.DFO_VENDOR_JOURNAL,
      'post-vendor-batch-to-dfo',
      {
        batchId,
        company,
        groupedJournals,
        sourceModule: 'VENDOR',
      },
    );

    this.logger.log(
      `Enqueued job ${job.id} for batch ${batchId} with ${groupedJournals.length} journal batches`,
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
      return date.toISOString();
    }
    if (typeof date === 'string') {
      // Try to parse and format
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date format: ${date}`);
      }
      return parsed.toISOString();
    }
    throw new Error(`Invalid date type: ${typeof date}`);
  }

  /**
   * Converts various boolean/string values to "Yes" or "No"
   */
  private convertToYesNo(
    value: string | boolean | undefined | null,
  ): 'Yes' | 'No' {
    if (value === null || value === undefined) {
      return 'No';
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    const str = String(value).trim().toLowerCase();
    if (str === 'yes' || str === 'true' || str === '1') {
      return 'Yes';
    }
    return 'No';
  }
}
