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

    const journalsToQueue = this.attachIntegrationIdentities(
      this.applyTestingMode(groupedJournals),
      batchId,
    );
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
        // Inbound routes are processor-agnostic. Every outbound AP route gets
        // its processor from the batch's Freight/Fleet entry processor type.
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
      // Cash-out batch line semantics (main-account-only + tax defaults) always
      // use direction "out". The route.lineDirection still selects the FO
      // custom API (VendPaym vs CustPaym) in the posting strategy.
      const mappedLines = this.mapLines(lines, company, 'out', route);

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
    const withholdingGroupKeys = new Set<string>();
    const primaryMarkedLinesByGroup = new Map<
      string,
      NonNullable<CashEntryDynDataModel['MarkedLines']>
    >();
    for (const record of lines) {
      const data = record.data;
      const accountMain = String(data.AccountDisplayValue ?? '')
        .trim()
        .split('|')[0]
        .trim();
      const offsetMain = String(data.OffsetAccountDisplayValue ?? '')
        .trim()
        .split('|')[0]
        .trim();
      const groupKey = String(
        data.PaymentId || data.SourceIds?.[0] || '',
      ).trim();
      const isWithholdingLine =
        accountMain.startsWith('223304') || offsetMain.startsWith('223304');
      if (groupKey && isWithholdingLine) {
        withholdingGroupKeys.add(groupKey);
      } else if (groupKey) {
        const existing = primaryMarkedLinesByGroup.get(groupKey);
        const hasExistingWithholding = existing?.some(
          (m) => m.HasWithHoldingLine,
        );
        if (data.MarkedLines?.length) {
          if (
            !hasExistingWithholding ||
            data.MarkedLines.some((m) => m.HasWithHoldingLine)
          ) {
            primaryMarkedLinesByGroup.set(groupKey, data.MarkedLines);
          }
        } else if (
          data.MarkedInvoice ||
          data.Invoice ||
          data.Document ||
          data.FinTagDisplayValue
        ) {
          const vendorGroup = String(data.VendorGroup ?? '').trim();
          const isCustody =
            vendorGroup.toLowerCase() === 'custody' ||
            data.SettlementTargetType === 'CustodyLedger';
          const op = this.stripBidiMarks(
            String(data.FinTagDisplayValue ?? '').split('|')[0],
          ).trim();
          const doc = String(data.Document ?? '').trim();
          const inv = isCustody
            ? ''
            : String(data.MarkedInvoice || data.Invoice || '').trim();
          if (inv || doc || op) {
            if (!hasExistingWithholding || inv) {
              primaryMarkedLinesByGroup.set(groupKey, [
                {
                  InvoiceNumber: inv,
                  OperationNumber: op,
                  DocumentNumber: isCustody ? doc : '',
                  HasWithHoldingLine: true,
                },
              ]);
            }
          }
        }
      }
    }

    return lines.map((lineRecord, groupLineIndex) => {
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

      // D365 assigns line numbers inside each created header. Reindex after
      // route splitting so retry/idempotency checks match the actual header.
      const lineNumber = groupLineIndex + 1;
      const transactionDate =
        line.TransactionDate || line.TransDate || line.Date || '';
      const credit = Number(line.CreditAmount ?? 0);
      const debit = Number(line.DebitAmount ?? 0);
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

      const markedInvoice = this.toOptionalInvoiceString(
        line.MarkedInvoice !== undefined
          ? line.MarkedInvoice
          : line.Invoice || '',
      );
      const vendorGroup = String(line.VendorGroup ?? '').trim();
      const isCustodyVendor =
        vendorGroup.toLowerCase() === 'custody' ||
        line.SettlementTargetType === 'CustodyLedger';
      const operationNumber = this.stripBidiMarks(
        String(line.FinTagDisplayValue ?? '').split('|')[0],
      ).trim();
      const documentNumber = String(line.Document ?? '').trim();
      const groupKey = String(
        line.PaymentId || line.SourceIds?.[0] || '',
      ).trim();
      const isWithholdingCompanion =
        (accountTypeStr === 'Vendor' &&
          String(line.OffsetAccountDisplayValue ?? '')
            .trim()
            .split('|')[0]
            .trim()
            .startsWith('223304')) ||
        (accountTypeStr === 'Ledger' &&
          String(line.AccountDisplayValue ?? '')
            .trim()
            .split('|')[0]
            .trim()
            .startsWith('223304'));
      const sourceMarkedLines =
        line.MarkedLines && line.MarkedLines.length > 0
          ? line.MarkedLines
          : isWithholdingCompanion
            ? primaryMarkedLinesByGroup.get(groupKey)
            : undefined;
      const hasAssociatedWithholding = Boolean(
        withholdingGroupKeys.has(groupKey) &&
        (isWithholdingCompanion ||
          String(line.IsWithholdingCalculationEnabled ?? '').toLowerCase() ===
            'yes' ||
          sourceMarkedLines?.some((marked) => marked.HasWithHoldingLine)),
      );
      // Settlement (marking) for Vendor Payment and Custody Settlement.
      // Prefer pre-built MarkedLines from formatting; synthesize from
      // VendorGroup / Invoice / Document / Operation when formatting left
      // the array empty (e.g. older batches or missing hydrate at format).
      const routeSupportsMarking =
        route?.safeType === 'Vendor Payment' ||
        route?.safeType === 'Custody Settlement';
      const markedLines = routeSupportsMarking
        ? sourceMarkedLines && sourceMarkedLines.length > 0
          ? sourceMarkedLines.map((markedLine) => ({
              // Prefer the formatted mark; fall back to MarkedInvoice so the
              // FO VendPaym body always carries settlement when format had it.
              InvoiceNumber: isCustodyVendor
                ? ''
                : this.toOptionalInvoiceString(
                    markedLine.InvoiceNumber || markedInvoice || '',
                  ),
              OperationNumber: this.stripBidiMarks(
                String(markedLine.OperationNumber ?? operationNumber),
              ).trim(),
              DocumentNumber: isCustodyVendor
                ? String(markedLine.DocumentNumber ?? documentNumber).trim()
                : '',
              HasWithHoldingLine:
                Boolean(markedLine.HasWithHoldingLine) ||
                hasAssociatedWithholding ||
                isWithholdingCompanion,
            }))
          : this.synthesizeCashOutMarkedLines({
              isCustodyVendor,
              markedInvoice,
              // Only Custody Settlement may fall back to Invoice when
              // MarkedInvoice was never populated. Vendor Payment keeps
              // intentional unmarked (cleared MarkedInvoice) as empty.
              invoice:
                route?.safeType === 'Custody Settlement'
                  ? this.toOptionalInvoiceString(line.Invoice)
                  : '',
              operationNumber,
              documentNumber,
              hasWithholdingLine:
                hasAssociatedWithholding || isWithholdingCompanion,
            })
        : [];
      const cashInMarkedLines =
        cashDirection === 'in'
          ? line.MarkedLines && line.MarkedLines.length > 0
            ? line.MarkedLines.map((markedLine) => ({
                InvoiceNumber: String(
                  markedLine.InvoiceNumber || markedInvoice || '',
                ).trim(),
                OperationNumber: this.stripBidiMarks(
                  String(markedLine.OperationNumber ?? ''),
                ).trim(),
                DocumentNumber: String(markedLine.DocumentNumber ?? '').trim(),
                HasWithHoldingLine: Boolean(markedLine.HasWithHoldingLine),
              }))
            : markedInvoice
              ? [
                  {
                    InvoiceNumber: markedInvoice,
                    OperationNumber: '',
                    DocumentNumber: '',
                    HasWithHoldingLine: false,
                  },
                ]
              : []
          : [];
      let transactionTextValue =
        line.TransactionText || line.Description || line.Text || '';
      const shouldAppendUnmarked =
        routeSupportsMarking &&
        markedLines.length === 0 &&
        !markedInvoice &&
        !transactionTextValue.toLowerCase().includes('unmarked');
      if (shouldAppendUnmarked) {
        transactionTextValue = transactionTextValue
          ? `${transactionTextValue} - Unmarked`
          : 'Unmarked';
      }
      let offsetTransactionTextValue =
        line.OffsetTransactionText || line.PaymentReference || '';
      if (
        routeSupportsMarking &&
        markedLines.length === 0 &&
        !markedInvoice &&
        !offsetTransactionTextValue.toLowerCase().includes('unmarked')
      ) {
        offsetTransactionTextValue = offsetTransactionTextValue
          ? `${offsetTransactionTextValue} - Unmarked`
          : 'Unmarked';
      }

      const documentDate = this.normalizeTransDateForCustomApi(
        this.formatDate(line.DocumentDate || transactionDate),
      );
      // Transaction ExchangeRate is already on FO's percentage-rate scale
      // (EGP = 100, USD≈4765). ReportingCurrencyExchRate is stored as a ratio
      // and scaled * 100 for the custom contract (USD reporting = 100).
      const exchangeRate = Number(line.ExchangeRate || line.ExchRate || 0);
      const reportingExchangeRate = (line.ReportingCurrencyExchRate || 0) * 100;

      // Dates before currency/rates: if FO assigns fields in JSON order,
      // TransDate must be present before CurrencyCode triggers rate lookup.
      // Cash Out X++ does jsonMap.lookup("ExchangeRate") unconditionally.
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
        transDate,
        DocumentNum: line.Document ?? '',
        DocumentDate: documentDate,

        creditAmount: credit,
        currency: line.CurrencyCode ?? '',
        debitAmount: debit,

        ...(cashDirection === 'out'
          ? {
              ExchangeRate: Number.isFinite(exchangeRate) ? exchangeRate : 0,
            }
          : {}),
        ReportingCurrencyExchRate: reportingExchangeRate,
        ReportingExchangeRate: reportingExchangeRate,
        REPORTINGEXCHANGERATE: reportingExchangeRate,
        ExchRateSecond: reportingExchangeRate,

        DEFAULTDIMENSIONDISPLAYVALUE: defaultDimDisplayValue,
        offsetDEFAULTDIMENSIONDISPLAYVALUE: offsetDefaultDimDisplayValue,
        FinTagStr: this.stripBidiMarks(line.FinTagDisplayValue ?? ''),
        ISPREPAYMENT: 'No',
        ITEMWITHHOLDINGTAXGROUP: '',
        IsWithholdingTaxCalculate: line.IsWithholdingCalculationEnabled ?? 'No',
        ISWITHHOLDINGTAXCALCULATE: line.IsWithholdingCalculationEnabled ?? 'No',

        // Main-account-only Cash Out lines keep offset blank. For classic AP
        // Vendor Payment (with an offset), FO still accepts an empty
        // OffsetAccountTypeStr while the offset account/dimensions are set.
        offsetAccountDisplayValue: offsetAccountDisplayValue,
        OffsetAccountTypeStr: offsetAccountTypeStr,
        OffsetCompany: line.OffsetCompany || company,
        OFFSETFINTAGDISPLAYVALUE: this.stripBidiMarks(
          line.OffsetFinTagDisplayValue ?? '',
        ),
        OFFSETTRANSACTIONTEXT: offsetTransactionTextValue,

        PAYMENTID: line.PaymentId ?? '',
        PAYMENTMETHODNAME:
          this.toOptionalTrimmedString(line.PaymentMethodName) ?? '',
        PAYMENTNOTES: transactionTextValue,
        PAYMENTREFERENCE: line.PaymentReference ?? '',
        // TODO: mapping is unknown; keeping empty until confirmed.
        PAYMENTSPECIFICATION: '',

        PostingProfile: this.resolvePostingProfile(
          line.PostingProfile,
          accountTypeStr,
        ),

        TaxGroup: this.normalizeCashTaxGroup(line.SalesTaxGroup),
        TAXITEMGROUP: line.ItemSalesTaxGroup ?? '',

        TRANSACTIONTEXT: transactionTextValue,
        Voucher: '',
      };

      // FO JournalLineContract::constructFromJsonObject always does
      // jsonMap.lookup("VendorGroup") (no exists check). Ledger / non-vendor
      // lines must still send an empty string or FO throws
      // `The value "VendorGroup" is not found in the map.`
      customLineApiBody.VendorGroup =
        cashDirection === 'out' && accountTypeStr === 'Vendor'
          ? vendorGroup || (isCustodyVendor ? 'Custody' : '')
          : '';

      if (cashDirection === 'out') {
        // Always send MarkedLines for any cash-out lines with markings
        // (including Custody Settlement and Withholding lines), and empty
        // array for AP vendor cash-out lines when unmarked.
        if (markedLines.length > 0) {
          customLineApiBody.MarkedLines = markedLines;
        } else if (accountTypeStr === 'Vendor') {
          customLineApiBody.MarkedLines = [];
        }
      } else if (cashDirection === 'in') {
        // Cash-In historically used MARKEDINVOICE only. Keep that field for
        // existing CustPaym behavior, but expose the same structured array
        // used by Cash-Out so settlement marks are not lost in the body.
        customLineApiBody.MarkedLines = cashInMarkedLines;
        if (routeSupportsMarking || markedInvoice) {
          customLineApiBody.MARKEDINVOICE = markedInvoice;
        }
      } else if (routeSupportsMarking || markedInvoice) {
        customLineApiBody.MARKEDINVOICE = markedInvoice;
      }

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
   * Build MarkedLines for Vendor Payment / Custody Settlement when formatting
   * did not already populate them.
   *
   * Custody vendor group → OperationNumber + DocumentNumber (Invoice empty)
   * Any other vendor group → InvoiceNumber + OperationNumber (Document empty)
   */
  private synthesizeCashOutMarkedLines(input: {
    isCustodyVendor: boolean;
    markedInvoice: string;
    invoice: string;
    operationNumber: string;
    documentNumber: string;
    hasWithholdingLine: boolean;
  }): Array<{
    InvoiceNumber: string;
    OperationNumber: string;
    DocumentNumber: string;
    HasWithHoldingLine: boolean;
  }> {
    const invoiceNumber = input.isCustodyVendor
      ? ''
      : input.markedInvoice || input.invoice;
    const documentNumber = input.isCustodyVendor ? input.documentNumber : '';
    const operationNumber = input.operationNumber;

    if (!invoiceNumber && !documentNumber && !operationNumber) {
      return [];
    }

    return [
      {
        InvoiceNumber: invoiceNumber,
        OperationNumber: operationNumber,
        DocumentNumber: documentNumber,
        HasWithHoldingLine: input.hasWithholdingLine,
      },
    ];
  }

  private isMainAccountOnlyLine(
    line: CashEntryDynDataModel,
    cashDirection: 'in' | 'out',
    _route: CashJournalRoute | undefined,
  ): boolean {
    // Cash-In is always one FO line per source row with no offset counterpart.
    if (cashDirection === 'in') {
      return true;
    }

    // Cash-Out accepts primary-account-only lines when offset fields are blank.
    return (
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

  private resolvePostingProfile(
    sourceProfile: string | undefined,
    accountType: TSLedgerJournalCustomAccountTypeStr,
  ): string {
    // Posting profiles belong to subledger accounts only. Sending V-PP for a
    // primary RCash/Bank/Ledger line makes FO look up that account in the
    // vendor posting profile (for example, "PSD EG" in V-PP) and the journal
    // cannot be posted.
    if (accountType !== 'Vendor' && accountType !== 'Cust') return '';

    const fromSource = String(sourceProfile ?? '').trim();
    if (fromSource) return fromSource;
    return accountType === 'Cust' ? 'Cust-PP' : 'V-PP';
  }

  private normalizeTransDateForCustomApi(dateIsoString: string): string {
    const v = dateIsoString?.trim() ?? '';
    if (!v) return '';
    // FO FormJsonSerializer / JournalLineContract expects
    // `yyyy-MM-ddT00:00:00` (no Z / millis). Date-only `yyyy-MM-dd` can
    // deserialize to dateNull on some X++ paths and surfaces as:
    // "exchange rate ... between currencies USD and EGP on exchange date ."
    const iso = v.replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
    const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? `${match[1]}T00:00:00` : iso;
  }

  private stripBidiMarks(value: string): string {
    return value.replace(
      /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,
      '',
    );
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

  private attachIntegrationIdentities(
    groupedJournals: CashJournalPostingGroup[],
    batchId: string,
  ): CashJournalPostingGroup[] {
    return groupedJournals.map((journal, journalIndex) => {
      if (!('route' in journal)) return journal;

      const integrationMarker = `MW:${batchId.slice(-12)}:${journalIndex}`;
      const suffix = ` [${integrationMarker}]`;
      // D365FO journal descriptions are limited to 60 characters. Preserve
      // the marker in full and shorten only the human-readable prefix.
      const maxDescriptionLength = 60;
      const prefix = String(journal.header.Description ?? '')
        .slice(0, Math.max(0, maxDescriptionLength - suffix.length))
        .trimEnd();

      return {
        ...journal,
        integrationMarker,
        header: {
          ...journal.header,
          Description: prefix ? `${prefix}${suffix}` : suffix.trim(),
        },
      };
    });
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
    _route?: CashJournalRoute,
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
    const isMainAccountOnlyCashLine =
      line.cashDirection === 'in' ||
      (!body.offsetDEFAULTDIMENSIONDISPLAYVALUE?.trim() &&
        !body.offsetAccountDisplayValue?.trim() &&
        !body.OffsetAccountTypeStr?.trim());
    if (!isMainAccountOnlyCashLine) {
      if (!body.offsetDEFAULTDIMENSIONDISPLAYVALUE?.trim()) {
        missingFields.push(
          'customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE',
        );
      }
      if (!body.offsetAccountDisplayValue?.trim()) {
        missingFields.push('customLineApiBody.offsetAccountDisplayValue');
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

  /**
   * Cash custom API accepts only Taxable / Non-Taxabl. Source SALESTAXGROUP is
   * often blank on Cash-In bank/customer lines — default to Non-Taxabl.
   */
  private normalizeCashTaxGroup(taxGroup: string | undefined | null): string {
    const value = taxGroup?.trim() ?? '';
    if (!value) return 'Non-Taxabl';

    const normalized = value.toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'taxable') return 'Taxable';
    if (normalized === 'nontaxabl' || normalized === 'nontaxable') {
      return 'Non-Taxabl';
    }

    return value;
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
    // A duplicate Redis submission is not proof of Finance integrity. The
    // worker is the only component allowed to transition a batch to Posted,
    // and it does so only after exact header, line, amount, and settlement
    // read-back succeeds.

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

  private toOptionalInvoiceString(value: string | undefined | null): string {
    if (value === null || value === undefined) return '';
    const sourceValue = String(value);
    return sourceValue.trim().length > 0 ? sourceValue : '';
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
