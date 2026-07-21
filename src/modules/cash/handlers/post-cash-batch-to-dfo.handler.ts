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
  TSLedgerJournalTransCustomRequestBody,
  TSLedgerJournalCustomAccountTypeStr,
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

    this.logger.log(`Received post-to-DFO request for cash batch ${batchId}`);

    const batch = await this.validateBatch(batchId);
    const cashDirection = this.getCashDirection(batch.entryProcessorType);
    this.ensureCashEntryProcessor(batch.entryProcessorType);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

    const groupedJournals = this.mapToD365FOCustomerPaymentRequests(
      journalGroups,
      batch.company,
      cashDirection,
    );

    const journalsToQueue = this.applyTestingMode(groupedJournals);
    this.validateCustomerPaymentJournals(journalsToQueue);

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(batchId, batch.company, {
      groupedJournals: journalsToQueue,
      cashDirection,
    });
  }

  private getCashDirection(
    entryProcessorType: EntryProcessorTypes,
  ): 'in' | 'out' {
    switch (entryProcessorType) {
      case EntryProcessorTypes.CashInFreight:
      case EntryProcessorTypes.CashInTrucking:
        return 'in';
      case EntryProcessorTypes.CashOutFreight:
      case EntryProcessorTypes.CashOutTrucking:
        return 'out';
      default:
        throw new BadRequestException(
          `Batch entryProcessorType ${entryProcessorType} is not supported for cash DFO posting`,
        );
    }
  }

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
    const cursor =
      await this.dataBatchService.getEnhancedRecordsStream(batchId);

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
    cashDirection: 'in' | 'out',
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
      const mappedLines = this.mapLines(lines, company, cashDirection);

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
    cashDirection: 'in' | 'out',
  ): D365FOCustomerPaymentJournalLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;

      const accountDisplayValue = line.AccountDisplayValue ?? '';
      const offsetAccountDisplayValue = line.OffsetAccountDisplayValue ?? '';
      const defaultDim = line.DefaultDimensionsForAccountDisplayValue
        ? line.DefaultDimensionsForAccountDisplayValue
        : line.DefaultDimensionDisplayValue ||
          this.toDefaultDimensionDisplayValue(accountDisplayValue) ||
          '';
      const offsetDefaultDim =
        line.DefaultDimensionsForOffsetAccountDisplayValue
          ? line.DefaultDimensionsForOffsetAccountDisplayValue
          : line.OffsetDefaultDimensionDisplayValue ||
            this.toDefaultDimensionDisplayValue(offsetAccountDisplayValue) ||
            '';

      const lineNumber = line.LineNumber ?? 0;
      const transactionDate =
        line.TransactionDate || line.TransDate || line.Date || '';
      const credit = Number(line.CreditAmount ?? 0);
      const debit = Number(line.DebitAmount ?? 0);
      const exchangeRate = line.ExchangeRate || line.ExchRate;
      const transDate = this.normalizeTransDateForCustomApi(
        this.formatDate(transactionDate),
      );

      const accountTypeStr = this.mapEntryAccountTypeStrForCustom(
        line.AccountType,
      );
      const offsetAccountTypeStr = this.mapEntryAccountTypeStrForCustom(
        line.OffsetAccountType,
      );

      const defaultDimDisplayValue =
        this.toOptionalTrimmedString(defaultDim) ?? '';
      const offsetDefaultDimDisplayValue =
        this.toOptionalTrimmedString(offsetDefaultDim) ?? '';

      const transactionTextValue =
        line.TransactionText || line.Description || line.Text || '';
      const offsetTransactionTextValue =
        line.OffsetTransactionText || line.PaymentReference || '';

      const customLineApiBody: TSLedgerJournalTransCustomRequestBody = {
        // This is filled later from the successful header-post response.
        journalNum: '',
        AccountNum: accountDisplayValue,
        accountTypeStr,

        BANKTRANSACTIONTYPE: this.mapVoucherTypeToBankTransactionType(
          line.VoucherType,
        ),
        CENTRALBANKPURPOSECODE: '',
        CENTRALBANKPURPOSETEXT: '',

        company,
        creditAmount: credit,
        currency: line.CurrencyCode ?? '',
        debitAmount: debit,

        DEFAULTDIMENSIONDISPLAYVALUE: defaultDimDisplayValue,
        offsetDEFAULTDIMENSIONDISPLAYVALUE: offsetDefaultDimDisplayValue,

        EXCHANGERATE: Number(exchangeRate),
        FinTagStr: line.FinTagDisplayValue ?? '',
        ISPREPAYMENT: 'No',
        ITEMWITHHOLDINGTAXGROUP: line.ItemWithholdingTaxGroupCode ?? '',
        MARKEDINVOICE: line.MarkedInvoice || line.Invoice || '',

        offsetAccountDisplayValue:
          offsetAccountDisplayValue || accountDisplayValue,
        OffsetAccountTypeStr: offsetAccountTypeStr,
        OffsetCompany: line.OffsetCompany || company,
        OFFSETFINTAGDISPLAYVALUE: line.OffsetFinTagDisplayValue ?? '',
        OFFSETTRANSACTIONTEXT: offsetTransactionTextValue,

        PAYMENTID: line.PaymentId ?? '',
        // TODO: confirm the exact source field for PAYMENTMETHODNAME.
        PAYMENTMETHODNAME: offsetAccountTypeStr,
        PAYMENTNOTES: transactionTextValue,
        PAYMENTREFERENCE: line.PaymentReference ?? '',
        // TODO: mapping is unknown; keeping empty until confirmed.
        PAYMENTSPECIFICATION: '',

        PostingProfile: line.PostingProfile ?? '',

        TaxGroup: line.SalesTaxGroup ?? '',
        TAXITEMGROUP: line.ItemSalesTaxGroup ?? '',

        transDate,
        TRANSACTIONTEXT: transactionTextValue,
        Voucher: '',
      };

      return {
        dataAreaId: company,
        LineNumber: lineNumber,
        cashDirection,
        customLineApiBody,
      };
    });
  }

  private normalizeTransDateForCustomApi(dateIsoString: string): string {
    const v = dateIsoString?.trim() ?? '';
    if (!v) return '';
    // Sample payload uses: 2026-04-21T00:00:00 (no milliseconds / no Z)
    return v.replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
  }

  private toDefaultDimensionDisplayValue(
    value: string | undefined | null,
  ): string | undefined {
    const trimmed = this.toOptionalTrimmedString(value);
    if (!trimmed?.includes('|') || trimmed.startsWith('|')) return trimmed;

    const segments = trimmed.split('|');
    if (segments.length !== 20) return undefined;

    return `|${segments.slice(1).join('|')}`;
  }

  private mapEntryAccountTypeStrForCustom(
    type: unknown,
  ): TSLedgerJournalCustomAccountTypeStr {
    const raw =
      typeof type === 'string' || typeof type === 'number'
        ? String(type).trim()
        : '';
    if (!raw) return '' as TSLedgerJournalCustomAccountTypeStr;

    const normalized = raw.toLowerCase().replace(/\s+/g, '');
    if (normalized === 'vend' || normalized === 'vendor') return 'Vendor';
    if (normalized === 'cust') return 'Cust';
    if (normalized === 'pettycash' || normalized === 'rcash') return 'RCash';
    if (normalized === 'bank') return 'Bank';
    if (normalized === 'ledger') return 'Ledger';

    return '' as TSLedgerJournalCustomAccountTypeStr;
  }

  private mapVoucherTypeToBankTransactionType(voucherType?: string): string {
    const t = String(voucherType ?? '').trim();
    const lower = t.toLowerCase();
    if (lower.includes('transfer')) return 'Transfer';
    if (lower.includes('cash')) return 'Cash';
    if (lower.includes('cheque')) return 'Cheque';
    if (lower.includes('deposit')) return 'Deposit';
    if (lower.includes('pos')) return 'POS';
    return '';
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
    if (line.LineNumber === undefined || line.LineNumber === null) {
      missingFields.push('LineNumber');
    }
    if (!line.cashDirection) {
      missingFields.push('cashDirection');
    }
    if (!line.customLineApiBody) {
      missingFields.push('customLineApiBody');
      return missingFields;
    }

    const body = line.customLineApiBody;
    if (!body.AccountNum?.trim()) {
      missingFields.push('customLineApiBody.AccountNum');
    }
    if (!body.accountTypeStr?.trim()) {
      missingFields.push('customLineApiBody.accountTypeStr');
    }
    if (!body.company?.trim()) {
      missingFields.push('customLineApiBody.company');
    }
    if (!body.currency?.trim()) {
      missingFields.push('customLineApiBody.currency');
    }
    if (!body.DEFAULTDIMENSIONDISPLAYVALUE?.trim()) {
      missingFields.push('customLineApiBody.DEFAULTDIMENSIONDISPLAYVALUE');
    }
    if (!body.offsetDEFAULTDIMENSIONDISPLAYVALUE?.trim()) {
      missingFields.push(
        'customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE',
      );
    }
    if (!body.offsetAccountDisplayValue?.trim()) {
      missingFields.push('customLineApiBody.offsetAccountDisplayValue');
    }
    if (!body.OffsetAccountTypeStr?.trim()) {
      missingFields.push('customLineApiBody.OffsetAccountTypeStr');
    }
    if (!body.OffsetCompany?.trim()) {
      missingFields.push('customLineApiBody.OffsetCompany');
    }
    if (!body.transDate?.trim()) {
      missingFields.push('customLineApiBody.transDate');
    }
    if (!body.PostingProfile?.trim()) {
      missingFields.push('customLineApiBody.PostingProfile');
    }
    if (!this.isValidTaxGroup(body.TaxGroup)) {
      missingFields.push(
        'customLineApiBody.TaxGroup (must be Taxable or Non-Taxabl)',
      );
    }

    return missingFields;
  }

  private isValidTaxGroup(taxGroup: string | undefined | null): boolean {
    const value = taxGroup?.trim() ?? '';
    return value === 'Taxable' || value === 'Non-Taxabl';
  }

  private async prepareBatchForPosting(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchService.updateStatusAsync(batchId, DataBatchStatus.Posting),
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
      cashDirection: 'in' | 'out';
    },
  ): Promise<PostCashBatchToDFOResult> {
    const submission = await this.queueService.addDurableJob(
      QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
      'post-customer-payment-journal-dfo',
      {
        batchId,
        company,
        cashDirection: payload.cashDirection,
        sourceModule: 'CASH',
        payloadVersion: 1,
      },
      payload.groupedJournals,
    );
    if (submission.status === 'already-completed') {
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Posted,
      );
    }

    this.logger.log(
      submission.status === 'queued' || submission.status === 'requeued'
        ? `${submission.message} Journal groups: ${payload.groupedJournals.length}`
        : submission.message,
    );

    return {
      jobId: submission.jobId,
      message: submission.message,
      submissionStatus: submission.status,
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
          validationRunId: doc.validationRunId,
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
      return '';
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

    return '';
  }
}
