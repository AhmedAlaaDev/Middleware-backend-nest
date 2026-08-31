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
import { isKnownCashMainAccountNeverBank } from '@/modules/cash/policies/cash-account-classification.policy';
import { normalizeCashCompositeDisplayValue } from '@/modules/cash/policies/cash-dimension.policy';
import {
  CashJournalRoute,
  CashJournalRoutingError,
  CashJournalRoutingService,
  CashTargetProcessor,
} from '@/modules/cash/services/cash-journal-routing.service';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
  D365FOVendorInvoiceJournalHeaderRequest,
  TSLedgerJournalTransCustomRequestBody,
  TSLedgerJournalCustomAccountTypeStr,
} from '@/modules/d365fo/types';
import { LedgerJournalHeaderRequest } from '@/modules/d365fo/types/d365fo-ledger.type';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  CashJournalHeaderRequest,
  CashJournalPostingGroup,
} from '@/modules/queue/contracts/post-customer-payment-journal-dfo-job.contract';
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
    private readonly routingService: CashJournalRoutingService = new CashJournalRoutingService(),
  ) {}

  public async execute(
    command: PostCashBatchToDFOCommand,
  ): Promise<PostCashBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Received post-to-DFO request for cash batch ${batchId}`);

    const batch = await this.validateBatch(batchId);
    const cashDirection = this.getCashDirection(batch.entryProcessorType);
    this.ensureCashEntryProcessor(batch.entryProcessorType);
    const targetProcessor = this.getTargetProcessor(batch.entryProcessorType);

    const journalGroups = await this.groupRecordsByJournalBatchNumber(
      batchId,
      cashDirection,
      targetProcessor,
    );

    const groupedJournals = this.mapToD365FOCashJournalRequests(
      journalGroups,
      batch.company,
      cashDirection,
      targetProcessor,
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

  private getTargetProcessor(
    entryProcessorType: EntryProcessorTypes,
  ): CashTargetProcessor | undefined {
    switch (entryProcessorType) {
      case EntryProcessorTypes.CashOutFreight:
        return 'Freight';
      case EntryProcessorTypes.CashOutTrucking:
        return 'Fleet';
      default:
        // Task 2045 uses Target Processor only for outbound Vendor Payment.
        return undefined;
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
    if (batch.postingPaused) {
      throw new BadRequestException(
        'Posting is paused for this batch. Resume posting before sending it to D365FO.',
      );
    }
    if ((batch.errorCount ?? 0) > 0) {
      throw new BadRequestException(
        `Batch contains ${batch.errorCount} validation error(s) and cannot be posted to D365FO. Correct the source data and upload or reprocess the batch before posting.`,
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
    cashDirection: 'in' | 'out',
    targetProcessor: CashTargetProcessor | undefined,
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
      const groupKey =
        cashDirection === 'out'
          ? this.cashOutGroupKey(
              journalBatchNumber,
              this.resolveCashOutRoute(data, targetProcessor),
            )
          : journalBatchNumber;
      if (!journalGroups.has(groupKey)) {
        journalGroups.set(groupKey, []);
      }

      journalGroups
        .get(groupKey)!
        .push(record as unknown as IDataEnhancedRecord<CashEntryDynDataModel>);
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }
    if (journalGroups.size === 0) {
      throw new BadRequestException(
        'No postable cash records were found. Every enhanced record is missing JournalBatchNumber.',
      );
    }

    this.logger.log(
      `Grouped ${recordCount} cash records into ${journalGroups.size} journal batches`,
    );

    return journalGroups;
  }

  private cashOutGroupKey(
    journalBatchNumber: string,
    route: CashJournalRoute,
  ): string {
    // Existing voucher/month/1,000-line batching is preserved. A route suffix
    // prevents a provisional batch from mixing different D365 header families.
    return [
      journalBatchNumber,
      route.kind,
      route.journalName,
      route.headerApi,
    ].join('::');
  }

  private resolveCashOutRoute(
    line: CashEntryDynDataModel,
    targetProcessor: CashTargetProcessor | undefined,
  ): CashJournalRoute {
    try {
      return this.routingService.resolve({
        safeType: line.SafeType,
        targetProcessor,
        voucherType: line.VoucherType,
      });
    } catch (error) {
      if (error instanceof CashJournalRoutingError) {
        throw new BadRequestException(
          `Cash line ${line.LineNumber ?? '?'}: ${error.message}`,
        );
      }
      throw error;
    }
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

  private mapToD365FOCashJournalRequests(
    journalGroups: Map<string, IDataEnhancedRecord<CashEntryDynDataModel>[]>,
    company: string,
    cashDirection: 'in' | 'out',
    targetProcessor: CashTargetProcessor | undefined,
  ): CashJournalPostingGroup[] {
    const result: CashJournalPostingGroup[] = [];

    for (const [_journalBatchNumber, lines] of journalGroups.entries()) {
      if (lines.length === 0) continue;

      if (cashDirection === 'in') {
        const header = this.mapHeaderFromLines(lines, company);
        const mappedLines = this.mapLines(lines, company, 'in');
        result.push({ header, lines: mappedLines });
        continue;
      }

      const route = this.resolveCashOutRoute(lines[0].data, targetProcessor);
      const header = this.mapRoutedHeaderFromLines(lines, company, route);
      const mappedLines = this.mapLines(
        lines,
        company,
        route.lineDirection,
        route,
      );

      result.push({ route, header, lines: mappedLines });
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

  private mapRoutedHeaderFromLines(
    lines: IDataEnhancedRecord<CashEntryDynDataModel>[],
    company: string,
    route: CashJournalRoute,
  ): CashJournalHeaderRequest {
    const firstLine = lines[0].data;
    const baseHeader = {
      dataAreaId: company,
      JournalName: route.journalName,
      Description: firstLine.Description ?? '',
    };

    if (route.kind === 'ledger') {
      return baseHeader as LedgerJournalHeaderRequest;
    }

    return {
      ...baseHeader,
      // AP/AR services omit this provisional value from the header POST. It is
      // retained for validation/audit, then replaced by D365's returned number.
      JournalBatchNumber: firstLine.JournalBatchNumber ?? '',
    } as
      | D365FOCustomerPaymentJournalHeaderRequest
      | D365FOVendorInvoiceJournalHeaderRequest;
  }

  private mapLines(
    lines: IDataEnhancedRecord<CashEntryDynDataModel>[],
    company: string,
    cashDirection: 'in' | 'out',
    route?: CashJournalRoute,
  ): D365FOCustomerPaymentJournalLineRequest[] {
    return lines.map((lineRecord, groupLineIndex) => {
      const line = lineRecord.data;

      const accountDisplayValue = this.normalizeCashInWcaEuDisplayValue(
        normalizeCashCompositeDisplayValue(line.AccountDisplayValue),
        cashDirection,
      );
      const offsetAccountDisplayValue = this.normalizeCashInWcaEuDisplayValue(
        normalizeCashCompositeDisplayValue(line.OffsetAccountDisplayValue),
        cashDirection,
      );
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

      // D365 assigns line numbers inside each created header. Reindex after
      // route splitting so retry/idempotency checks match the actual header.
      const lineNumber =
        cashDirection === 'in' && Number(line.LineNumber) > 0
          ? Number(line.LineNumber)
          : groupLineIndex + 1;
      const transactionDate =
        line.TransactionDate || line.TransDate || line.Date || '';
      const credit = Number(line.CreditAmount ?? 0);
      const debit = Number(line.DebitAmount ?? 0);
      const transDate = this.normalizeTransDateForCustomApi(
        this.formatDate(transactionDate),
      );

      const accountTypeStr = this.mapEntryAccountTypeStrForCustom(
        cashDirection === 'in' &&
        this.isCashInWcaEuAccount(line.AccountDisplayValue)
          ? 'Ledger'
          : line.AccountType,
      );
      const offsetAccountTypeStr = this.mapEntryAccountTypeStrForCustom(
        cashDirection === 'in' &&
        this.isCashInWcaEuAccount(line.OffsetAccountDisplayValue)
          ? 'Ledger'
          : line.OffsetAccountType,
      );

      const defaultDimDisplayValue =
        normalizeCashCompositeDisplayValue(defaultDim);
      const offsetDefaultDimDisplayValue =
        normalizeCashCompositeDisplayValue(offsetDefaultDim);

      const sourceMarkedInvoice = (
        line.MarkedInvoice !== undefined
          ? line.MarkedInvoice
          : line.Invoice || ''
      ).trim();
      const vendorGroup = String(line.VendorGroup ?? '').trim();
      const sourceMarkedLines =
        line.MarkedLines?.map((markedLine) => ({
          // D365's custom settlement endpoint compares the stored invoice
          // identity literally. Validation normalizes; posting preserves it.
          InvoiceNumber: String(markedLine.InvoiceNumber ?? ''),
          OperationNumber: String(markedLine.OperationNumber ?? '').trim(),
          DocumentNumber: String(markedLine.DocumentNumber ?? '').trim(),
          HasWithHoldingLine: Boolean(markedLine.HasWithHoldingLine),
        })) ?? [];
      // MarkedLines is authoritative for every Vendor Payment line, including
      // Vendor -> 223304 withholding companions. Do not clear or reconstruct
      // the identity at this posting boundary.
      const markedInvoice = sourceMarkedInvoice;
      const markedLines = sourceMarkedLines;
      const routeSupportsMarking = !route || route.kind === 'vendor-invoice';
      const isExplicitlyUnmarked =
        String((line as any).SettlementIntent ?? '')
          .trim()
          .toLowerCase() === 'unmarked';
      const isUnmarkedVendorSettlement =
        cashDirection === 'out' &&
        accountTypeStr === 'Vendor' &&
        ['Vendor Payment', 'Custody Settlement'].includes(
          String((line as any).SafeType ?? '').trim(),
        ) &&
        markedLines.length === 0;
      const unmarkedInvoice =
        String(line.Invoice ?? '').trim() ||
        sourceMarkedInvoice ||
        sourceMarkedLines
          .map((markedLine) => markedLine.InvoiceNumber.trim())
          .find(Boolean) ||
        '';
      const transactionTextValue =
        isExplicitlyUnmarked || isUnmarkedVendorSettlement
          ? unmarkedInvoice
            ? `Unmarked - ${unmarkedInvoice}`
            : 'Unmarked'
          : line.TransactionText || line.Description || line.Text || '';
      const offsetTransactionTextValue =
        line.OffsetTransactionText || line.PaymentReference || '';

      if (
        routeSupportsMarking &&
        accountTypeStr === 'Vendor' &&
        markedInvoice &&
        markedLines.length === 0
      ) {
        throw new BadRequestException(
          `Cash line ${line.LineNumber ?? '?'} has MarkedInvoice "${markedInvoice}" but no MarkedLines. Settlement intent must be resolved before posting.`,
        );
      }

      // Vendor-invoice settlement has a strict transaction identity contract.
      // Do not let the fallback below reconstruct an incomplete marked line:
      // D365 must receive both invoice and document for every marked line.
      const isVendorInvoiceSettlement =
        cashDirection === 'out' &&
        route?.kind === 'vendor-invoice' &&
        accountTypeStr === 'Vendor' &&
        markedLines.length > 0;
      if (isVendorInvoiceSettlement) {
        const allowsBlankInvoice =
          String((line as any).SafeType ?? '').trim() ===
            'Custody Settlement' &&
          (String((line as any).SettlementTargetType ?? '').trim() ===
            'CustodyLedger' ||
            Number(line.CreditAmount ?? 0) > 0);
        const invalidMarkedLine = markedLines.find(
          (markedLine) =>
            (!allowsBlankInvoice && !markedLine.InvoiceNumber.trim()) ||
            !markedLine.DocumentNumber,
        );
        if (invalidMarkedLine) {
          throw new BadRequestException(
            `Cash line ${line.LineNumber ?? '?'} has an invalid marked line. Vendor settlement requires both InvoiceNumber and DocumentNumber in every MarkedLines entry.`,
          );
        }
      }

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

        ...(cashDirection === 'out'
          ? {
              ExchRate:
                (line.CurrencyCode ?? '').trim().toUpperCase() === 'EGP'
                  ? 100
                  : line.ExchRate || 100,
              EXCHANGERATE:
                (line.CurrencyCode ?? '').trim().toUpperCase() === 'EGP'
                  ? 100
                  : line.ExchRate || 100,
              ReportingCurrencyExchRate:
                (line.ReportingCurrencyExchRate || 0) * 100,
              REPORTINGEXCHANGERATE:
                (line.ReportingCurrencyExchRate || 0) * 100,
              ExchRateSecond: (line.ReportingCurrencyExchRate || 0) * 100,
            }
          : {}),
        ExchangeRate:
          cashDirection === 'in'
            ? this.resolveCashInExchangeRate(line)
            : (line.CurrencyCode ?? '').trim().toUpperCase() === 'EGP'
              ? 100
              : line.ExchRate || 100,

        ReportingExchangeRate: (line.ReportingCurrencyExchRate || 0) * 100,

        DEFAULTDIMENSIONDISPLAYVALUE: defaultDimDisplayValue,
        offsetDEFAULTDIMENSIONDISPLAYVALUE: offsetDefaultDimDisplayValue,
        FinTagStr: line.FinTagDisplayValue ?? '',
        ISPREPAYMENT: 'No',
        ITEMWITHHOLDINGTAXGROUP: line.ItemWithholdingTaxGroupCode ?? '',
        IsWithholdingTaxCalculate: line.IsWithholdingCalculationEnabled ?? 'No',
        ISWITHHOLDINGTAXCALCULATE: line.IsWithholdingCalculationEnabled ?? 'No',

        offsetAccountDisplayValue: this.isMainAccountOnlyLine(
          line,
          cashDirection,
          route,
        )
          ? ''
          : route && route.kind !== 'vendor-invoice'
            ? offsetAccountDisplayValue
            : offsetAccountDisplayValue || accountDisplayValue,
        OffsetAccountTypeStr: offsetAccountTypeStr,
        OffsetCompany: line.OffsetCompany || company,
        OFFSETFINTAGDISPLAYVALUE: line.OffsetFinTagDisplayValue ?? '',
        OFFSETTRANSACTIONTEXT: offsetTransactionTextValue,

        PAYMENTID: line.PaymentId ?? '',
        PAYMENTMETHODNAME:
          this.toOptionalTrimmedString(line.PaymentMethodName) ?? '',
        PAYMENTNOTES:
          cashDirection === 'in'
            ? line.Description || line.TransactionText || ''
            : transactionTextValue,
        PAYMENTREFERENCE: line.PaymentReference ?? '',
        // TODO: mapping is unknown; keeping empty until confirmed.
        PAYMENTSPECIFICATION: '',

        PostingProfile: line.PostingProfile ?? '',

        TaxGroup: this.normalizeTaxGroup(line.SalesTaxGroup),
        TAXITEMGROUP: line.ItemSalesTaxGroup ?? '',

        transDate,
        DocumentNum: line.Document ?? '',
        DocumentDate: this.normalizeTransDateForCustomApi(
          this.formatDate(line.DocumentDate || transactionDate),
        ),
        TRANSACTIONTEXT: transactionTextValue,
        Voucher: '',
        MarkedLines: [],
      };

      // FO JournalLineContract::constructFromJsonObject always does
      // jsonMap.lookup("VendorGroup") (no exists check). Ledger / non-vendor
      // lines must still send an empty string or FO throws
      // `The value "VendorGroup" is not found in the map.`
      customLineApiBody.VendorGroup =
        cashDirection === 'out' && accountTypeStr === 'Vendor'
          ? vendorGroup
          : '';

      const isCashOutVendorSettlementLine =
        cashDirection === 'out' &&
        accountTypeStr === 'Vendor' &&
        ['Custody Settlement', 'Custody Issue', 'Vendor Payment'].includes(
          String((line as any).SafeType ?? '').trim(),
        );
      // Cash-out vendor settlement/issue bodies are strict: MarkedLines is the
      // authoritative settlement contract. Preserve every value from the
      // array (InvoiceNumber, OperationNumber, DocumentNumber, and
      // HasWithHoldingLine) and never reconstruct an entry from top-level
      // invoice/document fields.
      customLineApiBody.MarkedLines = isCashOutVendorSettlementLine
        ? markedLines
        : markedLines.length > 0
          ? markedLines
          : markedInvoice
            ? [
                {
                  InvoiceNumber: markedInvoice,
                  OperationNumber: String(
                    (line as any).OperationNumber ?? '',
                  ).trim(),
                  DocumentNumber: String(
                    (line as any).DocumentNumber ?? line.Document ?? '',
                  ).trim(),
                  HasWithHoldingLine: Boolean((line as any).HasWithHoldingLine),
                },
              ]
            : [];
      delete customLineApiBody.MARKEDINVOICE;

      if (this.isMainAccountOnlyLine(line, cashDirection, route)) {
        this.omitOffsetFields(customLineApiBody);
      }

      return {
        dataAreaId: company,
        LineNumber: lineNumber,
        cashDirection,
        customLineApiBody,
      };
    });
  }

  /**
   * Resolve the single transaction exchange-rate field used by the Cash-In
   * custom API contract.
   *
   * Cash-In lines created by the processor populate both ExchangeRate and
   * ExchRate for compatibility. The fallback to ExchangeRate also supports
   * already-formatted batches created before that synchronization fix.
   * EGP is D365's accounting currency and must be sent as 100. A missing
   * foreign-currency rate is rejected instead of silently becoming 100.
   */
  private resolveCashInExchangeRate(line: CashEntryDynDataModel): number {
    const currency = String(line.CurrencyCode ?? '').trim().toUpperCase();
    if (currency === 'EGP') return 100;

    const rate = [line.ExchRate, line.ExchangeRate]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);

    if (rate === undefined) {
      throw new BadRequestException(
        `Cash-In line ${line.LineNumber ?? '?'} has no valid exchange rate for currency ${currency || '(empty)'}.`,
      );
    }

    return rate;
  }

  private isCashInWcaEuAccount(value: unknown): boolean {
    return (
      String(value ?? '')
        .trim()
        .toUpperCase()
        .split('|')[0]
        ?.trim() === 'WCA-EU'
    );
  }

  private normalizeCashInWcaEuDisplayValue(
    value: string,
    cashDirection: 'in' | 'out',
  ): string {
    return cashDirection === 'in' && this.isCashInWcaEuAccount(value)
      ? '125902'
      : value;
  }

  private isMainAccountOnlyLine(
    line: CashEntryDynDataModel,
    cashDirection: 'in' | 'out',
    route: CashJournalRoute | undefined,
  ): boolean {
    return (
      cashDirection === 'out' &&
      route?.safeType !== 'Vendor Payment' &&
      !this.toOptionalTrimmedString(line.OffsetAccountType) &&
      !this.toOptionalTrimmedString(line.OffsetAccountDisplayValue)
    );
  }

  private omitOffsetFields(body: TSLedgerJournalTransCustomRequestBody): void {
    const payload = body as unknown as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      if (this.isOffsetFieldName(key)) delete payload[key];
    }
  }

  private isOffsetFieldName(fieldName: string): boolean {
    return fieldName.toLowerCase().startsWith('offset');
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
    groupedJournals: CashJournalPostingGroup[],
  ): CashJournalPostingGroup[] {
    if (!this.testingModeEnabled) {
      return groupedJournals;
    }

    const first = groupedJournals[0];
    if (!first) {
      return groupedJournals;
    }

    const limited = {
      ...first,
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

    return [limited as CashJournalPostingGroup];
  }

  private validateCustomerPaymentJournals(
    groupedJournals: CashJournalPostingGroup[],
  ): void {
    const validationErrors: Array<{
      journalIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }> = [];

    groupedJournals.forEach((journal, journalIndex) => {
      const requiresProvisionalBatchNumber =
        !('route' in journal) || journal.route.kind !== 'ledger';
      const headerErrors = this.validateHeader(
        journal.header,
        requiresProvisionalBatchNumber,
      );
      if (headerErrors.length > 0) {
        validationErrors.push({
          journalIndex,
          missingFields: headerErrors,
        });
      }

      journal.lines.forEach((line) => {
        const lineErrors = this.validateLine(
          line,
          'route' in journal ? journal.route : undefined,
        );
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
        message: 'Validation failed for routed cash journal data',
        errors: validationErrors,
        details: errorMessages.join('; '),
      });
    }
  }

  private validateHeader(
    header: CashJournalHeaderRequest,
    requiresProvisionalBatchNumber: boolean,
  ): string[] {
    const missingFields: string[] = [];

    if (!header.dataAreaId?.trim()) {
      missingFields.push('dataAreaId');
    }
    const provisionalBatchNumber =
      'JournalBatchNumber' in header ? header.JournalBatchNumber : undefined;
    if (requiresProvisionalBatchNumber && !provisionalBatchNumber?.trim()) {
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
    route?: CashJournalRoute,
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
    } else if (
      body.accountTypeStr === 'Bank' &&
      isKnownCashMainAccountNeverBank(body.AccountNum)
    ) {
      missingFields.push(
        `customLineApiBody.accountTypeStr: Account ${body.AccountNum} must be mapped as Ledger, not Bank`,
      );
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
    const isOffsetlessLine =
      line.cashDirection === 'out' &&
      route?.safeType !== 'Vendor Payment' &&
      !body.offsetDEFAULTDIMENSIONDISPLAYVALUE?.trim() &&
      !body.offsetAccountDisplayValue?.trim() &&
      !body.OffsetAccountTypeStr?.trim();
    if (!isOffsetlessLine) {
      if (!body.offsetDEFAULTDIMENSIONDISPLAYVALUE?.trim()) {
        missingFields.push(
          'customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE',
        );
      }
      if (!body.offsetAccountDisplayValue?.trim()) {
        missingFields.push('customLineApiBody.offsetAccountDisplayValue');
      } else if (
        body.OffsetAccountTypeStr === 'Bank' &&
        isKnownCashMainAccountNeverBank(body.offsetAccountDisplayValue)
      ) {
        missingFields.push(
          `customLineApiBody.OffsetAccountTypeStr: Offset account ${body.offsetAccountDisplayValue} must be mapped as Ledger, not Bank`,
        );
      }
      if (line.cashDirection !== 'out' && !body.OffsetAccountTypeStr?.trim()) {
        missingFields.push('customLineApiBody.OffsetAccountTypeStr');
      }
      if (!body.OffsetCompany?.trim()) {
        missingFields.push('customLineApiBody.OffsetCompany');
      }
    }
    if (!body.transDate?.trim()) {
      missingFields.push('customLineApiBody.transDate');
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

  private normalizeTaxGroup(taxGroup: string | undefined | null): string {
    const value = taxGroup?.trim() ?? '';
    if (!value) return 'Non-Taxabl';

    const normalized = value.toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'taxable') return 'Taxable';

    return 'Non-Taxabl';
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
      groupedJournals: CashJournalPostingGroup[];
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
        // Version 2 requires route metadata and is used only by task-2045
        // outbound groups. Cash-In keeps its backward-compatible v1 shape.
        payloadVersion: payload.cashDirection === 'out' ? 2 : 1,
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
