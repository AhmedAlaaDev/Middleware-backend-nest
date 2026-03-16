import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import {
  PostClosingBatchToDFOCommand,
  PostClosingBatchToDFOResult,
} from '@/modules/closing/commands';
import {
  DynClosingJournalEntryModel,
  DynCustodySettlementJournalEntryModel,
} from '@/modules/closing/models';
import {
  LedgerJournalHeaderRequest,
  LedgerJournalLineRequest,
} from '@/modules/d365fo/types/d365fo-ledger.type';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';

/** Ledger journal line shape used for DFO posting (closing and custody-settlement batches) */
type ClosingJournalEntryModel =
  | DynClosingJournalEntryModel
  | DynCustodySettlementJournalEntryModel;

@CommandHandler(PostClosingBatchToDFOCommand)
@Injectable()
export class PostClosingBatchToDFOHandler implements ICommandHandler<
  PostClosingBatchToDFOCommand,
  PostClosingBatchToDFOResult
> {
  private readonly logger = new Logger(PostClosingBatchToDFOHandler.name);
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
    command: PostClosingBatchToDFOCommand,
  ): Promise<PostClosingBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Starting post to DFO for ledger batch ${batchId}`);

    const batch = await this.validateBatch(batchId);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

    const groupedJournals = this.mapToD365Requests(
      journalGroups,
      batch.company,
    );

    const journalsToQueue = this.applyTestingMode(groupedJournals);
    this.validateJournals(journalsToQueue);

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(
      batchId,
      batch.company,
      journalsToQueue,
    );
  }

  private async validateBatch(batchId: string) {
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    const allowedTypes = [
      EntryProcessorTypes.LedgerFreightClosingEntry,
      EntryProcessorTypes.LedgerTruckingClosingEntry,
      EntryProcessorTypes.LedgerCustodySettlementEntry,
      EntryProcessorTypes.LedgerClosingFreightDifference,
    ];
    if (!allowedTypes.includes(batch.entryProcessorType)) {
      throw new BadRequestException(
        `Batch ${batchId} is not a ledger journal batch (closing or custody-settlement) (type: ${batch.entryProcessorType})`,
      );
    }
    return batch;
  }

  private async groupRecordsByJournalBatchNumber(
    batchId: string,
  ): Promise<Map<string, IDataEnhancedRecord<ClosingJournalEntryModel>[]>> {
    const cursor = this.dataBatchService.getEnhancedRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    const journalGroups = new Map<
      string,
      IDataEnhancedRecord<ClosingJournalEntryModel>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as ClosingJournalEntryModel;

      if (!this.isValidRecord(data, record.id)) {
        continue;
      }

      const journalBatchNumber = data.JournalBatchNumber;
      if (!journalGroups.has(journalBatchNumber)) {
        journalGroups.set(journalBatchNumber, []);
      }
      journalGroups
        .get(journalBatchNumber)!
        .push(
          record as unknown as IDataEnhancedRecord<ClosingJournalEntryModel>,
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

  private isValidRecord(
    data: ClosingJournalEntryModel,
    recordId: string,
  ): data is ClosingJournalEntryModel {
    if (!data || typeof data !== 'object') {
      return false;
    }
    if (!data.JournalBatchNumber?.trim()) {
      this.logger.warn(
        `Skipping record ${recordId}: missing JournalBatchNumber`,
      );
      return false;
    }
    return true;
  }

  private mapToD365Requests(
    journalGroups: Map<string, IDataEnhancedRecord<ClosingJournalEntryModel>[]>,
    company: string,
  ): Array<{
    header: LedgerJournalHeaderRequest;
    lines: LedgerJournalLineRequest[];
  }> {
    const groupedJournals: Array<{
      header: LedgerJournalHeaderRequest;
      lines: LedgerJournalLineRequest[];
    }> = [];

    for (const [_batchNumber, lines] of journalGroups.entries()) {
      if (lines.length === 0) continue;

      const firstLine = lines[0].data;
      const header: LedgerJournalHeaderRequest = {
        dataAreaId: company,
        JournalName: firstLine.JournalName,
        Description: firstLine.Description,
      };

      const mappedLines: LedgerJournalLineRequest[] = lines.map((record) =>
        this.mapLineToRequest(
          record.data,
          company,
          firstLine.JournalBatchNumber,
        ),
      );

      groupedJournals.push({ header, lines: mappedLines });
    }

    return groupedJournals;
  }

  private applyTestingMode(
    groupedJournals: Array<{
      header: LedgerJournalHeaderRequest;
      lines: LedgerJournalLineRequest[];
    }>,
  ): Array<{
    header: LedgerJournalHeaderRequest;
    lines: LedgerJournalLineRequest[];
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
      `DFO ledger journal TEST MODE enabled: enqueueing 1 header and ${limited.lines.length} lines (max ${this.testingModeMaxLines})`,
    );
    this.logger.log(
      `TEST MODE payload - header: ${JSON.stringify(limited.header, null, 2)}`,
    );
    this.logger.log(
      `TEST MODE payload - lines: ${JSON.stringify(limited.lines, null, 2)}`,
    );

    return [limited];
  }

  private mapLineToRequest(
    line: ClosingJournalEntryModel,
    company: string,
    journalBatchNumber: string,
  ): LedgerJournalLineRequest {
    return {
      dataAreaId: company,
      JournalBatchNumber: journalBatchNumber,
      CurrencyCode: line.CurrencyCode,
      TransDate: this.formatDate(line.TransDate),
      DocumentDate: line.DocumentDate
        ? this.formatDate(line.DocumentDate)
        : undefined,
      DueDate: line.DueDate ? this.formatDate(line.DueDate) : undefined,
      AccountType: line.AccountType,
      AccountDisplayValue: line.AccountDisplayValue,
      DefaultDimensionDisplayValue: line.DefaultDimensionDisplayValue,
      Text: line.Text,
      DebitAmount: line.DebitAmount,
      CreditAmount: line.CreditAmount,
      OffsetAccountType: line.OffsetAccountType,
      OffsetAccountDisplayValue: line.OffsetAccountDisplayValue,
      OffsetDefaultDimensionDisplayValue:
        line.OffsetDefaultDimensionDisplayValue,
      OffsetText: line.OffsetText,
      Voucher: line.Voucher,
      Document: line.Document ? line.Document.toString() : '',
      Invoice: line.Invoice ? line.Invoice.toString() : '',
      PostingProfile: line.PostingProfile,
      PaymentMethod: line.PaymentMethod,
      SalesTaxGroup: line.SalesTaxGroup,
      ItemSalesTaxGroup: line.ItemSalesTaxGroup,
      ExchRate: line.ExchangeRate,
      FinTagDisplayValue: line.FinTagDisplayValue || '',
      PaymentId: line.UniqueId?.toString() || '',
    };
  }

  private formatDate(date?: Date | string): string {
    if (!date) {
      return '';
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        return date;
      }
      return parsed.toISOString();
    }
    return String(date);
  }

  private validateJournals(
    groupedJournals: Array<{
      header: LedgerJournalHeaderRequest;
      lines: LedgerJournalLineRequest[];
    }>,
  ): void {
    const validationErrors: Array<{
      groupIndex?: number;
      lineIndex?: number;
      missingFields: string[];
    }> = [];

    groupedJournals.forEach((group, groupIndex) => {
      const headerErrors = this.validateHeader(group.header);
      if (headerErrors.length > 0) {
        validationErrors.push({
          groupIndex,
          missingFields: headerErrors,
        });
      }

      group.lines.forEach((line, lineIndex) => {
        const lineErrors = this.validateLine(line);
        if (lineErrors.length > 0) {
          validationErrors.push({
            groupIndex,
            lineIndex,
            missingFields: lineErrors,
          });
        }
      });
    });

    if (validationErrors.length > 0) {
      const errorMessages = validationErrors.map((e) => {
        if (e.lineIndex !== undefined) {
          return `Group ${e.groupIndex} line ${e.lineIndex}: [${e.missingFields.join(', ')}]`;
        }
        return `Group ${e.groupIndex} header: [${e.missingFields.join(', ')}]`;
      });
      throw new BadRequestException({
        message: 'Validation failed for ledger journal data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  private validateHeader(header: LedgerJournalHeaderRequest): string[] {
    const missing: string[] = [];
    if (!header.dataAreaId?.trim()) missing.push('dataAreaId');
    if (!header.JournalName?.trim()) missing.push('JournalName');
    if (!header.Description?.trim()) missing.push('Description');
    return missing;
  }

  private validateLine(line: LedgerJournalLineRequest): string[] {
    const missing: string[] = [];
    if (!line.JournalBatchNumber?.trim()) missing.push('JournalBatchNumber');
    if (!line.dataAreaId?.trim()) missing.push('dataAreaId');
    if (!line.AccountDisplayValue?.trim()) missing.push('AccountDisplayValue');
    if (
      (line.DebitAmount === undefined || line.DebitAmount === null) &&
      (line.CreditAmount === undefined || line.CreditAmount === null)
    ) {
      missing.push('DebitAmount or CreditAmount');
    }
    if (!line.FinTagDisplayValue?.trim()) missing.push('FinTagDisplayValue');
    return missing;
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
    groupedJournals: Array<{
      header: LedgerJournalHeaderRequest;
      lines: LedgerJournalLineRequest[];
    }>,
  ): Promise<PostClosingBatchToDFOResult> {
    const job = await this.queueService.addJob(
      QUEUES.DFO_LEDGER_JOURNAL,
      'post-ledger-journal-batch-to-dfo',
      {
        batchId,
        company,
        groupedJournals,
        sourceModule: 'Ledger',
      },
    );

    this.logger.log(
      `Enqueued job ${job.id} for batch ${batchId} with ${groupedJournals.length} journal groups`,
    );

    return {
      jobId: job.id!,
      message: `Batch ${batchId} queued for posting to D365FO. Job ID: ${job.id}`,
    };
  }

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
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {});
      }
    }
  }
}
