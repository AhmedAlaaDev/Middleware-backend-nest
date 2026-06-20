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
  D365FOVendorPaymentJournalHeaderRequest,
  D365FOVendorPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';
import {
  PostVendorBatchToDFOCommand,
  PostVendorBatchToDFOResult,
} from '@/modules/vendor/commands';
import { VendorEntryDynDataModel } from '@/modules/vendor/models';

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

    this.logger.log(`Received post-to-DFO request for vendor batch ${batchId}`);

    const batch = await this.validateBatch(batchId);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

    const isPaymentBatch =
      batch.entryProcessorType === EntryProcessorTypes.VendorPaymentFreight ||
      batch.entryProcessorType === EntryProcessorTypes.VendorPaymentTrucking;

    if (isPaymentBatch) {
      const paymentGroupedJournals = this.mapToD365FOPaymentRequests(
        journalGroups,
        batch.company,
      );
      this.validatePaymentJournals(paymentGroupedJournals);
      await this.prepareBatchForPosting(batchId);
      return await this.enqueuePostingJob(batchId, batch.company, {
        journalKind: 'payment',
        paymentGroupedJournals,
      });
    }

    const groupedJournals = this.mapToD365FORequests(
      journalGroups,
      batch.company,
    );

    const journalsToQueue = this.applyTestingMode(groupedJournals);
    this.validateJournals(journalsToQueue);

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(batchId, batch.company, {
      journalKind: 'invoice',
      groupedJournals: journalsToQueue,
    });
  }

  /**
   * Validates that the batch exists
   */
  private async validateBatch(batchId: string) {
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    if (
      batch.status === DataBatchStatus.Posting ||
      batch.status === DataBatchStatus.Posted ||
      batch.status === DataBatchStatus.Revalidating
    ) {
      throw new BadRequestException(
        `Batch status is ${batch.status} and cannot be posted to D365FO.`,
      );
    }
    return batch;
  }

  /**
   * Groups enhanced records by journal batch number (supports both header and header-less line shapes).
   */
  private async groupRecordsByJournalBatchNumber(
    batchId: string,
  ): Promise<Map<string, IDataEnhancedRecord<VendorEntryDynDataModel>[]>> {
    const cursor =
      await this.dataBatchService.getEnhancedRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    const journalGroups = new Map<
      string,
      IDataEnhancedRecord<VendorEntryDynDataModel>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as VendorEntryDynDataModel;

      if (!this.isValidVendorRecord(data, record.id)) {
        continue;
      }

      const journalBatchNumber = this.getLineJournalBatchNumber(data);
      if (!journalGroups.has(journalBatchNumber)) {
        journalGroups.set(journalBatchNumber, []);
      }

      journalGroups
        .get(journalBatchNumber)!
        .push(
          record as unknown as IDataEnhancedRecord<VendorEntryDynDataModel>,
        );
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Grouped ${recordCount} records into ${journalGroups.size} journal batches`,
    );

    return journalGroups;
  }

  private getLineJournalBatchNumber(line: VendorEntryDynDataModel): string {
    return line.JournalBatchNumber ?? '';
  }

  private isValidVendorRecord(
    data: VendorEntryDynDataModel,
    recordId: string,
  ): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const batchNum = this.getLineJournalBatchNumber(data);
    if (!batchNum?.trim()) {
      this.logger.warn(
        `Skipping record ${recordId}: missing JOURNALBATCHNUMBER/JournalBatchNumber`,
      );
      return false;
    }
    return true;
  }

  /**
   * Maps grouped records to D365FO request types
   */
  private mapToD365FORequests(
    journalGroups: Map<string, IDataEnhancedRecord<VendorEntryDynDataModel>[]>,
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
   * Maps the first line of a journal group to a header request.
   * Supports both lines with a `header` property and header-less (VendorEntryDynDataModel) lines.
   */
  private mapHeaderFromLines(
    lines: IDataEnhancedRecord<VendorEntryDynDataModel>[],
    company: string,
  ): D365FOVendorInvoiceJournalHeaderRequest {
    const firstLine = lines[0].data;

    if (firstLine?.JournalBatchNumber != null) {
      return {
        dataAreaId: company,
        JournalBatchNumber: firstLine.JournalBatchNumber,
        JournalName: firstLine.JournalName ?? '',
        Description: firstLine.Description ?? '',
      };
    }

    // Header-less shape (e.g. VendorEntryDynDataModel): derive from first line
    const journalBatchNumber = this.getLineJournalBatchNumber(firstLine);
    const journalName = firstLine.JournalName ?? '';
    const description = firstLine.Description ?? '';
    return {
      dataAreaId: company,
      JournalBatchNumber: journalBatchNumber,
      JournalName: journalName,
      Description: description,
    };
  }

  /**
   * Maps journal lines to D365FO line requests.
   * Normalizes both PascalCase (VendorEntryDynDataModel) and uppercase (VendorFreightDFOLine) property names.
   */
  private mapLines(
    lines: IDataEnhancedRecord<VendorEntryDynDataModel>[],
    company: string,
  ): D365FOVendorInvoiceJournalLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;

      const accountType = line.AccountType ?? '';
      const accountDisplayValue = line.AccountDisplayValue ?? '';
      const defaultDim = line.DefaultDimensionDisplayValue ?? '';

      const displayValue =
        accountType === 'Ledger' && defaultDim?.trim()
          ? accountDisplayValue + defaultDim.trim()
          : accountDisplayValue;

      const journalBatchNumber = this.getLineJournalBatchNumber(line);
      const lineNumber = line.LineNumber ?? 0;
      const postingProfile = line.PostingProfile ?? '';
      const finTag = line.FinTagDisplayValue ?? '';
      const reportingRate = line.ReportingCurrencyExchRate ?? 0;
      const termsOfPayment = line.TermsOfPayment ?? '';
      const exchRateSecond = line.ExchRateSecond ?? 0;
      const transactionType = 'Vendor';
      const methodOfPayment = line.MethodOfPayment ?? '';
      const exchRate = line.ExchRate ?? 1;
      const document = line.Document ?? '';
      const description = line.Description ?? '';
      const invoice = line.Invoice ?? '';
      const date = line.Date ?? '';
      const voucher = line.Voucher ?? '';
      const currency = line.Currency ?? '';
      const itemWithholding = line.ItemWithholdingTaxGroupCode ?? '';
      const invoiceDate = line.InvoiceDate ?? date;
      const debit = Number(line.Debit ?? 0);
      const dueDate = line.DueDate ?? '';
      const salesTaxGroup = line.SalesTaxGroup ?? '';
      const itemSalesTaxGroup = line.ItemSalesTaxGroup ?? '';
      const credit = Number(line.Credit ?? 0);
      const paymId = line.PaymId ?? '';

      this.assertValidDateInput(date, 'Date', lineNumber);
      this.assertValidDateInput(invoiceDate, 'InvoiceDate', lineNumber);
      this.assertValidDateInput(dueDate, 'DueDate', lineNumber);

      return {
        dataAreaId: company,
        JournalBatchNumber: journalBatchNumber,
        LineNumber: lineNumber,
        AccountDisplayValue: displayValue,
        PostingProfile: postingProfile,
        DefaultDimensionDisplayValue: this.toOptionalTrimmedString(defaultDim),
        FinTagDisplayValue: finTag,
        ReportingCurrencyExchRate: reportingRate,
        AccountType: accountType as 'Vend' | 'Ledger',
        TermsOfPayment: this.toOptionalTrimmedString(termsOfPayment),
        ExchRateSecond: exchRateSecond || 0,
        TransactionType: transactionType,
        MethodOfPayment: this.toOptionalTrimmedString(methodOfPayment),
        ExchRate: exchRate,
        Document: document != null ? String(document) : undefined,
        Description: this.toOptionalTrimmedString(description),
        Invoice: invoice,
        Date: this.formatDate(date),
        Voucher: voucher != null ? String(voucher) : undefined,
        Currency: currency,
        ItemWithholdingTaxGroupCode:
          this.toOptionalTrimmedString(itemWithholding),
        InvoiceDate: invoiceDate
          ? this.formatDate(invoiceDate)
          : this.formatDate(date),
        Debit: debit,
        DueDate: dueDate ? this.formatDate(dueDate) : undefined,
        SalesTaxGroup: this.toOptionalTrimmedString(salesTaxGroup),
        ItemSalesTaxGroup: this.toOptionalTrimmedString(itemSalesTaxGroup),
        PaymId: paymId,
        Credit: credit,
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

  /**
   * Maps grouped records to D365FO vendor payment request types (headers + payment lines).
   */
  private mapToD365FOPaymentRequests(
    journalGroups: Map<string, IDataEnhancedRecord<VendorEntryDynDataModel>[]>,
    company: string,
  ): Array<{
    header: D365FOVendorPaymentJournalHeaderRequest;
    lines: D365FOVendorPaymentJournalLineRequest[];
  }> {
    const result: Array<{
      header: D365FOVendorPaymentJournalHeaderRequest;
      lines: D365FOVendorPaymentJournalLineRequest[];
    }> = [];

    for (const [_journalBatchNumber, lines] of journalGroups.entries()) {
      if (lines.length === 0) continue;

      const header = this.mapHeaderFromLines(
        lines,
        company,
      ) as D365FOVendorPaymentJournalHeaderRequest;
      const mappedLines = this.mapLinesToPaymentRequest(lines, company);

      result.push({ header, lines: mappedLines });
    }

    return result;
  }

  /**
   * Maps journal lines to D365FO vendor payment journal line requests.
   * Uses CreditAmount/DebitAmount, TransactionDate, TransactionText, CurrencyCode, etc.
   */
  private mapLinesToPaymentRequest(
    lines: IDataEnhancedRecord<VendorEntryDynDataModel>[],
    company: string,
  ): D365FOVendorPaymentJournalLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;

      const accountType = (line.AccountType ?? '') as 'Vend' | 'Ledger';
      const accountDisplayValue = line.AccountDisplayValue ?? '';
      const defaultDim = line.DefaultDimensionDisplayValue ?? '';
      const displayValue =
        accountType === 'Ledger' && defaultDim?.trim()
          ? accountDisplayValue + defaultDim.trim()
          : accountDisplayValue;

      const journalBatchNumber = this.getLineJournalBatchNumber(line);
      const date = line.Date ?? '';
      const credit = Number(line.Credit ?? 0);
      const debit = Number(line.Debit ?? 0);
      const lineNumber = line.LineNumber ?? 0;

      this.assertValidDateInput(date, 'TransactionDate', lineNumber);

      return {
        dataAreaId: company,
        JournalBatchNumber: journalBatchNumber,
        LineNumber: lineNumber,
        AccountDisplayValue: displayValue,
        AccountType: accountType,
        PaymentId: this.toOptionalTrimmedString(line.PaymId),
        FinTagDisplayValue: this.toOptionalTrimmedString(
          line.FinTagDisplayValue,
        ),
        TransactionDate: this.formatDate(date),
        PostingProfile: line.PostingProfile ?? '',
        ReportingCurrencyExchRate: line.ReportingCurrencyExchRate ?? 0,
        ReportingCurrencyExchRateSecondary:
          line.ReportingCurrencyExchRateSecondary ?? 0,
        TransactionText: this.toOptionalTrimmedString(line.Description),
        CurrencyCode: line.Currency ?? '',
        ExchangeRate: line.ExchRate ?? 1,
        CreditAmount: credit,
        DebitAmount: debit,
        Voucher: this.toOptionalTrimmedString(line.Voucher),
        DefaultDimensionsForAccountDisplayValue: this.toOptionalTrimmedString(
          defaultDim || line.DefaultDimensionDisplayValue,
        ),
        Company: company,
        MarkedInvoice: this.toOptionalTrimmedString(line.Invoice),
      } as D365FOVendorPaymentJournalLineRequest;
    });
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
    if (!header.Description?.trim()) {
      missingFields.push('Description');
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
    if (!line.FinTagDisplayValue?.trim()) {
      missingFields.push('FinTagDisplayValue');
    }

    return missingFields;
  }

  /**
   * Validates payment journal headers and lines
   */
  private validatePaymentJournals(
    groupedJournals: Array<{
      header: D365FOVendorPaymentJournalHeaderRequest;
      lines: D365FOVendorPaymentJournalLineRequest[];
    }>,
  ): void {
    const validationErrors: Array<{
      journalIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }> = [];

    groupedJournals.forEach((journal, journalIndex) => {
      const headerErrors = this.validatePaymentHeader(journal.header);
      if (headerErrors.length > 0) {
        validationErrors.push({
          journalIndex,
          missingFields: headerErrors,
        });
      }

      journal.lines.forEach((line) => {
        const lineErrors = this.validatePaymentLine(line);
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
        message: 'Validation failed for vendor payment journal data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  private validatePaymentHeader(
    header: D365FOVendorPaymentJournalHeaderRequest,
  ): string[] {
    const missingFields: string[] = [];
    if (!header.dataAreaId?.trim()) missingFields.push('dataAreaId');
    if (!header.JournalBatchNumber?.trim())
      missingFields.push('JournalBatchNumber');
    if (!header.JournalName?.trim()) missingFields.push('JournalName');
    if (!header.Description?.trim()) missingFields.push('Description');
    return missingFields;
  }

  private validatePaymentLine(
    line: D365FOVendorPaymentJournalLineRequest,
  ): string[] {
    const missingFields: string[] = [];
    if (!line.dataAreaId?.trim()) missingFields.push('dataAreaId');
    if (!line.JournalBatchNumber?.trim())
      missingFields.push('JournalBatchNumber');
    if (line.LineNumber === undefined || line.LineNumber === null)
      missingFields.push('LineNumber');
    if (!line.AccountDisplayValue?.trim())
      missingFields.push('AccountDisplayValue');
    if (!line.AccountType?.trim()) missingFields.push('AccountType');
    if (!line.CurrencyCode?.trim()) missingFields.push('CurrencyCode');
    if (!line.TransactionDate?.trim()) missingFields.push('TransactionDate');
    if (line.ExchangeRate === undefined || line.ExchangeRate === null)
      missingFields.push('ExchangeRate');
    if (line.CreditAmount === undefined || line.CreditAmount === null)
      missingFields.push('CreditAmount');
    if (line.DebitAmount === undefined || line.DebitAmount === null)
      missingFields.push('DebitAmount');
    if (!line.Company?.trim()) missingFields.push('Company');
    if (line.CreditAmount > 0 && line.DebitAmount > 0) {
      missingFields.push('CreditAmount and DebitAmount cannot both be > 0');
    }
    return missingFields;
  }

  /**
   * Prepares batch for posting by updating status and clearing errors
   */
  private async prepareBatchForPosting(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchService.updateStatusAsync(batchId, DataBatchStatus.Posting),
      this.dataBatchService.clearDfoPostingErrorsAsync(batchId),
    ]);
  }

  /**
   * Enqueues the posting job and returns the result.
   * Supports both invoice and payment journal kinds.
   */
  private async enqueuePostingJob(
    batchId: string,
    company: string,
    payload: {
      journalKind: 'invoice' | 'payment';
      groupedJournals?: Array<{
        header: D365FOVendorInvoiceJournalHeaderRequest;
        lines: D365FOVendorInvoiceJournalLineRequest[];
      }>;
      paymentGroupedJournals?: Array<{
        header: D365FOVendorPaymentJournalHeaderRequest;
        lines: D365FOVendorPaymentJournalLineRequest[];
      }>;
    },
  ): Promise<PostVendorBatchToDFOResult> {
    const groups =
      payload.journalKind === 'invoice'
        ? (payload.groupedJournals ?? [])
        : (payload.paymentGroupedJournals ?? []);
    const submission = await this.queueService.addDurableJob(
      QUEUES.DFO_VENDOR_JOURNAL,
      'post-vendor-batch-to-dfo',
      {
        batchId,
        company,
        journalKind: payload.journalKind,
        sourceModule: 'VENDOR',
        payloadVersion: 1,
      },
      groups,
    );
    if (submission.status === 'already-completed') {
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Posted,
      );
    }

    const journalCount =
      payload.journalKind === 'invoice'
        ? (payload.groupedJournals?.length ?? 0)
        : (payload.paymentGroupedJournals?.length ?? 0);

    this.logger.log(
      submission.status === 'queued' || submission.status === 'requeued'
        ? `${submission.message} Journal type: ${payload.journalKind}; groups: ${journalCount}`
        : submission.message,
    );

    return {
      jobId: submission.jobId,
      message: submission.message,
      submissionStatus: submission.status,
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
          validationRunId: doc.validationRunId,
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
      return '';
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      // Try to parse and format
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        return '';
      }
      return parsed.toISOString();
    }
    return '';
  }

  private assertValidDateInput(
    date: Date | string | undefined,
    fieldName: string,
    lineNumber: number,
  ): void {
    if (date === undefined || date === null) {
      return;
    }

    if (date instanceof Date) {
      if (isNaN(date.getTime())) {
        throw new BadRequestException(
          `Line ${lineNumber}: invalid ${fieldName} format`,
        );
      }
      return;
    }

    const value = String(date).trim();
    if (!value) {
      return;
    }

    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Line ${lineNumber}: invalid ${fieldName} format (${value})`,
      );
    }
  }
}
