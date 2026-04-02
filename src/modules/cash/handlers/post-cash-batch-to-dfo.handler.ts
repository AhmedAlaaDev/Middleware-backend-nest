import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import {
  PostCashBatchToDFOCommand,
  PostCashBatchToDFOResult,
} from '@/modules/cash/commands';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(PostCashBatchToDFOCommand)
@Injectable()
export class PostCashBatchToDFOHandler implements ICommandHandler<
  PostCashBatchToDFOCommand,
  PostCashBatchToDFOResult
> {
  private readonly logger = new Logger(PostCashBatchToDFOHandler.name);
  private readonly testingModeEnabled = process.env.NODE_ENV === 'development';
  private readonly testingModeMaxLines = 10;

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: PostCashBatchToDFOCommand,
  ): Promise<PostCashBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Starting post to DFO for cash batch ${batchId}`);

    const batch = await this.validateBatch(batchId);
    this.ensureCashEntryProcessor(batch.entryProcessorType);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

    const groupedJournals = this.mapToD365FOCustomerPaymentRequests(
      journalGroups,
      batch.company,
    );

    const journalsToQueue = this.applyTestingMode(groupedJournals);
    this.validateCustomerPaymentJournals(journalsToQueue);

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(batchId, batch.company, {
      groupedJournals: journalsToQueue,
    });
  }

  private async validateBatch(batchId: string) {
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    return batch;
  }

  private ensureCashEntryProcessor(entryProcessorType: EntryProcessorTypes) {
    const allowed = [
      EntryProcessorTypes.CashInFreight,
      EntryProcessorTypes.CashOutFreight,
      EntryProcessorTypes.CashInTrucking,
      EntryProcessorTypes.CashOutTrucking,
    ];
    if (!allowed.includes(entryProcessorType)) {
      throw new BadRequestException(
        `Batch entryProcessorType ${entryProcessorType} is not supported for cash DFO posting`,
      );
    }
  }

  private async groupRecordsByJournalBatchNumber(
    batchId: string,
  ): Promise<Map<string, IDataEnhancedRecord<CashEntryDynDataModel>[]>> {
    const cursor = this.dataBatchService.getEnhancedRecordsStream(batchId);

    const recordsStream =
      this.cursorToAsyncIterable<CashEntryDynDataModel>(cursor);

    const journalGroups = new Map<
      string,
      IDataEnhancedRecord<CashEntryDynDataModel>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as CashEntryDynDataModel;
      if (!this.isValidCashRecord(data, record.id)) {
        continue;
      }

      const journalBatchNumber = data.JournalBatchNumber ?? '';
      if (!journalGroups.has(journalBatchNumber)) {
        journalGroups.set(journalBatchNumber, []);
      }

      journalGroups
        .get(journalBatchNumber)!
        .push(record as unknown as IDataEnhancedRecord<CashEntryDynDataModel>);
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Grouped ${recordCount} cash records into ${journalGroups.size} journal batches`,
    );

    return journalGroups;
  }

  private isValidCashRecord(
    data: CashEntryDynDataModel,
    recordId: string,
  ): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const batchNum = data.JournalBatchNumber ?? '';
    if (!batchNum?.trim()) {
      this.logger.warn(
        `Skipping cash record ${recordId}: missing JournalBatchNumber`,
      );
      return false;
    }
    return true;
  }

  private mapToD365FOCustomerPaymentRequests(
    journalGroups: Map<string, IDataEnhancedRecord<CashEntryDynDataModel>[]>,
    company: string,
  ): Array<{
    header: D365FOCustomerPaymentJournalHeaderRequest;
    lines: D365FOCustomerPaymentJournalLineRequest[];
  }> {
    const result: Array<{
      header: D365FOCustomerPaymentJournalHeaderRequest;
      lines: D365FOCustomerPaymentJournalLineRequest[];
    }> = [];

    for (const [_journalBatchNumber, lines] of journalGroups.entries()) {
      if (lines.length === 0) continue;

      const header = this.mapHeaderFromLines(lines, company);
      const mappedLines = this.mapLines(lines, company);

      result.push({ header, lines: mappedLines });
    }

    return result;
  }

  private mapHeaderFromLines(
    lines: IDataEnhancedRecord<CashEntryDynDataModel>[],
    company: string,
  ): D365FOCustomerPaymentJournalHeaderRequest {
    const firstLine = lines[0].data;

    return {
      dataAreaId: company,
      JournalBatchNumber: firstLine.JournalBatchNumber ?? '',
      JournalName: firstLine.JournalName ?? '',
      Description: firstLine.Description ?? '',
    };
  }

  private mapLines(
    lines: IDataEnhancedRecord<CashEntryDynDataModel>[],
    company: string,
  ): D365FOCustomerPaymentJournalLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;

      const accountType = line.AccountType ?? '';
      const accountDisplayValue = line.AccountDisplayValue ?? '';
      const offsetAccountDisplayValue = line.OffsetAccountDisplayValue ?? '';
      const defaultDim = line.DefaultDimensionsForAccountDisplayValue
        ? line.DefaultDimensionsForAccountDisplayValue
        : (line.DefaultDimensionDisplayValue ?? '');
      const offsetDefaultDim =
        line.DefaultDimensionsForOffsetAccountDisplayValue
          ? line.DefaultDimensionsForOffsetAccountDisplayValue
          : (line.OffsetDefaultDimensionDisplayValue ?? '');

      const journalBatchNumber = line.JournalBatchNumber ?? '';
      const lineNumber = line.LineNumber ?? 0;
      const transactionDate =
        line.TransactionDate || line.TransDate || line.Date || '';
      const credit = Number(line.CreditAmount ?? 0);
      const debit = Number(line.DebitAmount ?? 0);

      return {
        dataAreaId: company,
        JournalBatchNumber: journalBatchNumber,
        LineNumber: lineNumber,
        AccountDisplayValue: accountDisplayValue,
        AccountType: accountType,
        PaymentId: line.PaymentId,
        FinTagDisplayValue: line.FinTagDisplayValue,
        OffsetFinTagDisplayValue: line.OffsetFinTagDisplayValue,
        TransactionDate: this.formatDate(transactionDate),
        PostingProfile: line.PostingProfile ?? '',
        ReportingCurrencyExchRate: line.ReportingCurrencyExchRate,
        ReportingCurrencyExchRateSecondary:
          line.ReportingCurrencyExchRateSecondary,
        TransactionText:
          line.TransactionText || line.Description || line.Text || undefined,
        CurrencyCode: line.CurrencyCode ?? '',
        ExchangeRate:
          line.ExchangeRate ||
          line.ExchRate ||
          line.ReportingCurrencyExchRate ||
          1,
        CreditAmount: credit,
        DebitAmount: debit,
        Voucher: line.Voucher || undefined,
        DefaultDimensionsForAccountDisplayValue:
          this.toOptionalTrimmedString(defaultDim),
        DefaultDimensionsForOffsetAccountDisplayValue:
          this.toOptionalTrimmedString(offsetDefaultDim),
        OffsetAccountType: line.OffsetAccountType as string,
        OffsetAccountDisplayValue:
          offsetAccountDisplayValue || accountDisplayValue,
        Company: line.Company || company,
        OffsetCompany: line.OffsetCompany || company,
        OffsetTransactionText:
          line.OffsetTransactionText || line.PaymentReference || undefined,
        MarkedInvoice: line.MarkedInvoice || undefined,
      } as D365FOCustomerPaymentJournalLineRequest;
    });
  }

  private applyTestingMode(
    groupedJournals: Array<{
      header: D365FOCustomerPaymentJournalHeaderRequest;
      lines: D365FOCustomerPaymentJournalLineRequest[];
    }>,
  ): Array<{
    header: D365FOCustomerPaymentJournalHeaderRequest;
    lines: D365FOCustomerPaymentJournalLineRequest[];
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
      `DFO cash journal TEST MODE enabled: enqueueing 1 header and ${limited.lines.length} lines (max ${this.testingModeMaxLines})`,
    );
    this.logger.log(
      `TEST MODE payload - header: ${JSON.stringify(limited.header, null, 2)}`,
    );
    this.logger.log(
      `TEST MODE payload - lines: ${JSON.stringify(limited.lines, null, 2)}`,
    );

    return [limited];
  }

  private validateCustomerPaymentJournals(
    groupedJournals: Array<{
      header: D365FOCustomerPaymentJournalHeaderRequest;
      lines: D365FOCustomerPaymentJournalLineRequest[];
    }>,
  ): void {
    const validationErrors: Array<{
      journalIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }> = [];

    groupedJournals.forEach((journal, journalIndex) => {
      const headerErrors = this.validateHeader(journal.header);
      if (headerErrors.length > 0) {
        validationErrors.push({
          journalIndex,
          missingFields: headerErrors,
        });
      }

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
        message: 'Validation failed for cash customer payment journal data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  private validateHeader(
    header: D365FOCustomerPaymentJournalHeaderRequest,
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

  private validateLine(
    line: D365FOCustomerPaymentJournalLineRequest,
  ): string[] {
    const missingFields: string[] = [];

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
    if (!line.AccountType?.trim()) {
      missingFields.push('AccountType');
    }
    if (!line.CurrencyCode?.trim()) {
      missingFields.push('CurrencyCode');
    }
    if (!line.TransactionDate?.trim()) {
      missingFields.push('TransactionDate');
    }
    if (line.ExchangeRate === undefined || line.ExchangeRate === null) {
      missingFields.push('ExchangeRate');
    }
    if (line.CreditAmount === undefined || line.CreditAmount === null) {
      missingFields.push('CreditAmount');
    }
    if (line.DebitAmount === undefined || line.DebitAmount === null) {
      missingFields.push('DebitAmount');
    }
    if (!line.Company?.trim()) {
      missingFields.push('Company');
    }
    if (!line.OffsetCompany?.trim()) {
      missingFields.push('OffsetCompany');
    }
    if (!line.OffsetAccountType?.trim()) {
      missingFields.push('OffsetAccountType');
    }
    if (!line.OffsetAccountDisplayValue?.trim()) {
      missingFields.push('OffsetAccountDisplayValue');
    }
    if (!line.FinTagDisplayValue?.trim()) {
      missingFields.push('FinTagDisplayValue');
    }
    if (!line.OffsetFinTagDisplayValue?.trim()) {
      missingFields.push('OffsetFinTagDisplayValue');
    }

    return missingFields;
  }

  private async prepareBatchForPosting(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Processing,
      ),
      this.dataBatchService.clearDfoPostingErrorsAsync(batchId),
    ]);
  }

  private async enqueuePostingJob(
    batchId: string,
    company: string,
    payload: {
      groupedJournals: Array<{
        header: D365FOCustomerPaymentJournalHeaderRequest;
        lines: D365FOCustomerPaymentJournalLineRequest[];
      }>;
    },
  ): Promise<PostCashBatchToDFOResult> {
    const jobData = {
      batchId,
      company,
      groupedJournals: payload.groupedJournals,
      sourceModule: 'CASH' as const,
    };

    const job = await this.queueService.addJob(
      QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
      'post-customer-payment-journal-dfo',
      jobData,
    );

    this.logger.log(
      `Enqueued customer payment job ${job.id} for batch ${batchId} with ${payload.groupedJournals.length} journal batches`,
    );

    return {
      jobId: job.id!,
      message: `Batch ${batchId} queued for posting to D365FO (customer payment). Job ID: ${job.id}`,
    };
  }

  private toOptionalTrimmedString(
    value: string | undefined | null,
  ): string | undefined {
    if (value === null || value === undefined) return undefined;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async *cursorToAsyncIterable<TData>(
    cursor: any,
  ): AsyncIterable<IDataEnhancedRecord<TData>> {
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          dimensionModel: doc.dimensionModel,
          sourceIds: doc.sourceIds || [],
          data: doc.data as TData,
          dataModelType: doc.dataModelType,
        };
      }
    } finally {
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {
          // ignore errors on close
        });
      }
    }
  }

  private formatDate(date?: Date | string): string {
    if (!date) {
      throw new Error('Date is required');
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date format: ${date}`);
      }
      return parsed.toISOString();
    }
    throw new Error(`Invalid date type: ${typeof date}`);
  }
}
