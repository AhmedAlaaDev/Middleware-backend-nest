import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { capitalize } from '@/lib/utils';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  isCash22420LedgerDimensionLine,
  isCashNotesReceivableLine,
  sanitizeCashOutboundInvoice,
} from '@/modules/cash/policies/cash-account.policy';
import {
  resolveCashOffsetAccountDisplayValue,
  toCashDefaultDimensionDisplayValue,
} from '@/modules/cash/policies/cash-dimension.policy';
import {
  firstCashFinancialTag,
  formatCashInboundInvoice,
  replaceCashShippingLineWithVendorName,
} from '@/modules/cash/policies/cash-invoice.policy';
import {
  analyzeCashWithholding,
  isCashWithholdingLedgerLine,
} from '@/modules/cash/policies/cash-withholding.policy';
import {
  filterCashSettlementLines,
  resolveCashPaymentMethod,
} from '@/modules/cash/policies/cash-line.policy';
import {
  getCashCollectionDescriptionLabel,
  resolveCashJournalName,
} from '@/modules/cash/policies/cash-journal.policy';
import {
  assignCashMissingUniqueIds,
  classifyCashLines,
} from '@/modules/cash/policies/cash-batch.policy';
import { mapCashRawData } from '@/modules/cash/policies/cash-normalization.policy';
import {
  CashJournalRoute,
  CashJournalRoutingError,
  CashJournalRoutingService,
} from '@/modules/cash/services/cash-journal-routing.service';
import {
  CashOutExchangeRateContext,
  CashOutExchangeRateResolution,
  CashOutExchangeRateService,
} from '@/modules/cash/services/cash-out-exchange-rate.service';
import { ProcessCustodySettlementEntryCommand } from '@/modules/closing/commands/process-custody-settlement-entry.command';
import {
  CustodySettlementTarget,
  GeneralJournalService,
} from '@/modules/d365fo/services/general-journal.service';
import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { VendorService } from '@/modules/d365fo/services/vendor.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDimensionsModel,
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { GetVendorsQuery } from '@/modules/master-data/queries';
import {
  ProcessVendorPaymentFreightCommand,
  ProcessVendorPaymentTruckingCommand,
} from '@/modules/vendor/commands';

type RawDataInvoiceMap = Map<string, CashEntryRawDataModel[]>;

@Injectable()
export abstract class BaseCashEntryProcessor extends EntryProcessorBase {
  protected readonly logger = new Logger(BaseCashEntryProcessor.name);
  private readonly cashJournalRoutingService = new CashJournalRoutingService();
  private readonly cashOutExchangeRateService: CashOutExchangeRateService;
  private readonly generalJournalService: GeneralJournalService;
  private readonly d365VendorService?: VendorService;

  protected readonly MAX_LINES_PER_BATCH = 1000;

  /**
   * Cash-out: Set of `invoice|vendorAccount` keys that exist on
   * VendInvoiceJournalLines (filled once per enrich via batched FO lookup).
   */
  protected vendorInvoiceExistsMap: Set<string> | null = null;

  protected readonly MAIN_ACCOUNTS_NP_MAP: Record<number, number> = {
    211201: 223201,
    211202: 223202,
    211203: 223203,
    211204: 223204,

    224200: 223201,
    224201: 223201,
    224202: 223201,
    224203: 223201,
    224204: 223201,
    224205: 223201,
    224206: 223201,
    224207: 223201,
    224208: 223201,
    224209: 223201,
    224210: 223201,
    224211: 223201,

    224300: 223202,
    224301: 223202,
    224302: 223202,
    224303: 223202,
    224304: 223202,
    224305: 223202,
    224306: 223202,
    224307: 223202,
    224308: 223202,
    224309: 223202,
    224310: 223202,
    224311: 223202,

    224400: 223203,
    224401: 223203,
    224402: 223203,
    224403: 223203,
    224404: 223203,
    224405: 223203,
    224406: 223203,
    224407: 223203,
    224408: 223203,
    224409: 223203,
    224410: 223203,
    224411: 223203,

    224500: 223204,
    224501: 223204,
    224502: 223204,
    224503: 223204,
    224504: 223204,
    224505: 223204,
    224506: 223204,
    224507: 223204,
    224508: 223204,
    224509: 223204,
    224510: 223204,
    224511: 223204,
  };

  abstract readonly entryProcessorType: EntryProcessorTypes;
  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  /** Cash-In uses free-text invoice checks; Cash-Out does not. */
  protected abstract isInbound(): boolean;

  /** Freight vs Fleet (trucking) product line — drives journal names and descriptions. */
  protected abstract isTrucking(): boolean;

  constructor(
    protected readonly commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super({ dependencies: baseDeps });
    this.cashOutExchangeRateService = baseDeps.cashOutExchangeRateService;
    this.generalJournalService = baseDeps.generalJournalService;
    this.d365VendorService = baseDeps.d365VendorService;
  }

  public async formatAndEnrichAsync(
    data: EntryRawDataModel[],
    company: string,
  ): Promise<EntryDynDataModel[]> {
    this.company = company;

    await this.warmupProcessorData({
      // Task 2047: Cash-Out obtains a file-scoped snapshot directly from D365
      // after the source dates/currencies are normalized. Cash-In retains the
      // existing synchronized master-data behavior.
      exchangeRates: this.isInbound(),
      customerNames: this.isInbound(),
      vendorNames: !this.isInbound(),
    });

    const rawCount = data.length;
    this.logger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records ${this.isInbound() ? '( Cash-In )' : '( Cash-Out )'}${this.isTrucking() ? ' ( Trucking )' : ' ( Freight )'}`,
    );

    this.logger.debug(`[STEP 1] Mapping ${rawCount} raw records to models`);
    const rawLines = mapCashRawData(
      data,
      this.isTrucking() ? 'Fleet' : 'Freight',
      this.isInbound(),
    );
    const assignedIds = assignCashMissingUniqueIds(rawLines);
    if (assignedIds.assignedLineCount > 0) {
      this.logger.debug(
        `[STEP 1] Assigned UniqueIds to ${assignedIds.assignedLineCount} lines from ${assignedIds.voucherCount} vouchers`,
      );
    }
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    if (!this.isInbound()) {
      await this.validateCashOutSourceAsync(rawLines);
    }

    const cashOutExchangeRateContext =
      await this.cashOutExchangeRateService.load(company, rawLines);

    if (cashOutExchangeRateContext) {
      this.logger.debug(
        `[STEP 1.25] Loaded Cash-Out D365 exchange-rate snapshot for ${cashOutExchangeRateContext.ratesByCurrency.size} currencies, range ${cashOutExchangeRateContext.earliestTransactionDate ?? 'n/a'}..${cashOutExchangeRateContext.requestEndDate ?? 'n/a'}`,
      );
    }

    this.logger.debug(
      `[STEP 1.5] Sorting ${rawLines.length} lines by line number`,
    );
    const sortedLines = this.sortRawDataByLineNumber(rawLines);
    this.logger.debug(`[STEP 1.5] Sorted to ${sortedLines.length} lines`);

    let processedLines = sortedLines;
    let withholdingStats: any = null;

    if (!this.isInbound()) {
      withholdingStats = analyzeCashWithholding(sortedLines);
    }

    this.logger.debug(
      `[STEP 2] Filtering lines from ${processedLines.length} lines${this.isInbound() ? ' (cash-in splits custody)' : ' (cash-out keeps all)'}`,
    );
    const { custodySettlementLines, otherLines, vendorPayment } =
      classifyCashLines(processedLines, this.isInbound());
    this.logger.debug(
      `[FILTER] Processed ${processedLines.length} lines → ${custodySettlementLines.length} custody settlement, ${vendorPayment.length} vendor payment, ${otherLines.length} remaining lines`,
    );

    this.logger.debug(
      `[STEP 3] Building invoice map from ${otherLines.length} lines`,
    );
    const invoiceMap = this.buildUniqueIdMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.logger.debug(`[STEP 3] Grouped into ${invoiceCount} invoices`);

    this.logger.debug(
      `[STEP 3.5] Checking invoice balanced after FX for ${invoiceCount} invoices`,
    );
    this.checkInvoiceBalancedAfterFx(invoiceMap, cashOutExchangeRateContext);

    if (this.unbalancedUniqueIds.size > 0) {
      this.logger.error(
        `[STEP 3.5] Found ${this.unbalancedUniqueIds.size} unbalanced invoices after FX`,
      );
    } else {
      this.logger.debug(`[STEP 3.5] All invoices are balanced after FX`);
    }

    this.logger.debug(
      `[STEP 4] Building DFO lines from ${invoiceCount} invoices`,
    );
    const dfoLines = this.buildInvoiceLines(
      invoiceMap,
      cashOutExchangeRateContext,
    );
    this.logger.debug(`[STEP 4] Built ${dfoLines.length} DFO lines`);

    this.logger.debug(
      `[STEP 5] Updating batch and voucher numbers for ${dfoLines.length} lines`,
    );
    const updatedDfoLines = this.utilsService.updateCashBatchAndVoucher({
      lines: dfoLines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
      maxLinesPerBatch: this.MAX_LINES_PER_BATCH,
    });
    this.logger.debug(
      `[STEP 5] Updated batch and voucher numbers for ${updatedDfoLines.length} lines`,
    );

    if (this.isInbound()) {
      this.logger.debug(
        `[STEP 6] Fetching free text invoices for ${updatedDfoLines.length} lines`,
      );
      await this.fetchFreeTextInvoices({
        invoiceNumbers: updatedDfoLines.map((line) => line.MarkedInvoice ?? ''),
      });
      this.logger.debug(
        `[STEP 6] Fetched free text invoices ${this.freeTextInvoiceMap?.size} invoices`,
      );
    } else {
      this.logger.debug(
        `[STEP 6] Batch-looking up vendor invoices on VendInvoiceJournalLines for ${updatedDfoLines.length} lines`,
      );
      await this.fetchVendorInvoiceExistsMap(updatedDfoLines);
      this.logger.debug(
        `[STEP 6] Vendor invoice pair map size: ${this.vendorInvoiceExistsMap?.size ?? 0}`,
      );
    }

    this.logger.debug(
      `[STEP 7] Processing ${custodySettlementLines.length} custody settlement lines`,
    );
    this.processCustodySettlementLines(custodySettlementLines);

    if (!this.isInbound()) {
      this.logger.debug(
        `[STEP 7] Processing ${vendorPayment.length} vendor payment lines`,
      );
      this.processVendorPaymentLines(vendorPayment);
    }

    if (withholdingStats) {
      (updatedDfoLines as any).metadata = withholdingStats;
    }
    return updatedDfoLines;
  }

  public validateAsync(
    data: EntryDynDataModel[],
    _company?: string,
  ): EntryDynDataModel[] {
    const lines = data as unknown as CashEntryDynDataModel[];
    const lineCount = lines.length;
    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      if (this.unbalancedUniqueIds.has(line.SourceIds[0])) {
        line.AddError('UnbalancedInvoice', 'Invoice is unbalanced after FX');
      }

      if (this.isInbound() && this.isTrucking()) {
        this.validateDimensionsForLine(line, {
          dimensionIsRequired: {
            TruckerType: line.AccountType === 'Ledger',
          },
        });
      } else {
        this.validateDimensionsForLine(line);
      }

      if (this.isInbound() && this.freeTextInvoiceMap) {
        const invoiceKey = (line.MarkedInvoice || line.Invoice || '')
          .trim()
          .toLowerCase();

        if (!invoiceKey) {
          line.AddError('Invoice', 'Invoice is missing');
          continue;
        }

        const entries = this.freeTextInvoiceMap.get(invoiceKey);

        const displayInvoice = line.MarkedInvoice || line.Invoice;

        if (!entries?.length) {
          line.AddError(
            'Invoice',
            `Free text invoice (${displayInvoice}) not exists in D365FO`,
          );
          continue;
        }

        const postedEntries = entries.filter((e) => e.isPosted);

        if (postedEntries.length === 0) {
          line.AddError(
            'Invoice',
            `(${displayInvoice}) exists in D365FO but is not posted (IsPosted=No)`,
          );
          continue;
        }
      }

      if (!this.isInbound()) {
        let shouldValidateCashOutMarkedInvoice = true;
        try {
          const route = this.cashJournalRoutingService.resolve({
            safeType: line.SafeType,
            targetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
            voucherType: line.VoucherType,
          });
          // Only AP Vendor Payment routes settle against vendor invoices.
          // GL routes and AR customer-payment routes must not inherit the
          // vendor/account ownership validation.
          shouldValidateCashOutMarkedInvoice =
            route.kind === 'vendor-invoice' &&
            line.SettlementTargetType !== 'CustodyLedger';
        } catch (error) {
          const message =
            error instanceof CashJournalRoutingError
              ? error.message
              : `Unable to resolve cash journal route: ${String(error)}`;
          line.AddError('SafeType', message);
        }

        if (shouldValidateCashOutMarkedInvoice) {
          this.validateCashOutMarkedInvoice(line);
        }
      }
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  protected async validateCashOutSourceAsync(
    lines: CashEntryRawDataModel[],
  ): Promise<void> {
    const errors: string[] = [];
    const lineContext = (line: CashEntryRawDataModel) =>
      `Line ${line.LINENUMBER || '?'} (UniqueId ${line.UniqueId || '?'})`;

    for (const line of lines) {
      this.collectSourceDimensionErrors(line, errors);

      const hasWithholding =
        isCashWithholdingLedgerLine(line) ||
        String(line.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
          'yes' ||
        Boolean(line.ITEMWITHHOLDINGTAXGROUPCODE);
      if (
        hasWithholding &&
        !line.IsVendorPayment &&
        !line.IsCustodySettlement
      ) {
        errors.push(
          `${lineContext(line)}: withholding is not supported for SafeType ${line.SafeType}.`,
        );
      }
    }

    for (const [sourceId, group] of this.buildUniqueIdMap(lines)) {
      const safeTypes = new Set(group.map((line) => line.SafeType));
      if (safeTypes.size > 1) {
        errors.push(
          `UniqueId ${sourceId}: all rows must use the same SafeType; found ${[...safeTypes].join(', ')}.`,
        );
      }
      if (!group[0]?.IsVendorPayment) continue;

      const vendors = group.filter(
        (line) => line.IsVendor && Number(line.DEBITAMOUNT) > 0,
      );
      const paymentOffsets = group.filter(
        (line) =>
          Number(line.CREDITAMOUNT) > 0 && !isCashWithholdingLedgerLine(line),
      );
      const invalidDebitLines = group.filter(
        (line) => Number(line.DEBITAMOUNT) > 0 && !line.IsVendor,
      );
      if (
        vendors.length === 0 ||
        paymentOffsets.length !== 1 ||
        invalidDebitLines.length > 0
      ) {
        errors.push(
          `UniqueId ${sourceId}: Vendor Payment requires one credit payment offset and one or more debit Vendor lines. Found ${vendors.length} Vendor line(s), ${paymentOffsets.length} payment offset(s), and ${invalidDebitLines.length} non-Vendor debit line(s).`,
        );
      }
    }

    await this.collectSettlementTargetErrors(lines, errors);

    if (errors.length > 0) {
      throw new BadRequestException({
        message:
          'Cash Out pre-format validation failed. No journal request was generated.',
        errorCount: errors.length,
        errors,
      });
    }
  }

  private collectSourceDimensionErrors(
    line: CashEntryRawDataModel,
    errors: string[],
  ): void {
    const validateSide = (
      label: 'account' | 'offset',
      accountType: string,
      accountDisplayValue: string,
      defaultDimensionDisplayValue: string,
      finTagDisplayValue: string,
    ) => {
      const dimensionString =
        accountType === 'Ledger'
          ? accountDisplayValue
          : defaultDimensionDisplayValue;
      if (!dimensionString?.trim()) return;

      const dimensions =
        this.utilsService.parseDimensionString(dimensionString);
      const sourceSegments = dimensionString.split('|');
      if (!String(sourceSegments[12] ?? '').trim()) {
        dimensions.freightType = undefined;
      }
      const validationLine = new CashEntryDynDataModel(dimensions, {
        SourceIds: [String(line.UniqueId)],
        AccountType: accountType as any,
        AccountDisplayValue: accountDisplayValue,
        FinTagDisplayValue: finTagDisplayValue,
      });
      this.validateDimensionsForLine(validationLine);
      for (const error of validationLine.GetErrors()) {
        errors.push(
          `Line ${line.LINENUMBER || '?'} (UniqueId ${line.UniqueId || '?'}) ${label}: ${error}`,
        );
      }
    };

    validateSide(
      'account',
      line.ACCOUNTTYPE,
      line.ACCOUNTDISPLAYVALUE,
      line.DEFAULTDIMENSIONDISPLAYVALUE,
      line.FINTAGDISPLAYVALUE,
    );
    if (
      line.OFFSETACCOUNTTYPE ||
      line.OFFSETACCOUNTDISPLAYVALUE ||
      line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE
    ) {
      validateSide(
        'offset',
        line.OFFSETACCOUNTTYPE,
        line.OFFSETACCOUNTDISPLAYVALUE,
        line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
        line.OFFSETFINTAGDISPLAYVALUE,
      );
    }
  }

  private async collectSettlementTargetErrors(
    lines: CashEntryRawDataModel[],
    errors: string[],
  ): Promise<void> {
    const vendorLines = lines.filter(
      (line) => line.IsVendorPayment && line.IsVendor,
    );
    if (vendorLines.length === 0) return;

    const vendorAccounts = [
      ...new Set(
        vendorLines
          .map((line) => String(line.ACCOUNTDISPLAYVALUE ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const vendorResult = await this.queryBus.execute(
      new GetVendorsQuery({
        company: this.company,
        accountNumbers: vendorAccounts,
      }),
    );
    const vendorItems = [...(vendorResult?.items ?? [])];
    const vendorGroupByAccount = new Map<string, string>(
      vendorItems.map((vendor) => [
        String(vendor.vendorAccountNumber).trim().toLowerCase(),
        String(vendor.vendorGroupId ?? '').trim(),
      ]),
    );
    const cachedAccounts = new Set(
      vendorItems.map((vendor) =>
        String(vendor.vendorAccountNumber ?? '')
          .trim()
          .toLowerCase(),
      ),
    );
    const missingAccounts = vendorAccounts.filter(
      (account) => !cachedAccounts.has(account.toLowerCase()),
    );

    if (missingAccounts.length > 0 && this.d365VendorService) {
      this.logger.warn(
        `Vendor master data is missing ${missingAccounts.length} account(s); loading vendor groups directly from D365FO`,
      );
      const missingAccountSet = new Set(
        missingAccounts.map((account) => account.toLowerCase()),
      );
      const liveVendors = await this.d365VendorService.getAllVendors(
        this.company,
        {
          useCache: true,
          select: ['VendorAccountNumber', 'VendorGroupId'],
        },
      );
      for (const vendor of liveVendors) {
        const account = String(vendor.VendorAccountNumber ?? '')
          .trim()
          .toLowerCase();
        if (!missingAccountSet.has(account)) continue;
        vendorGroupByAccount.set(
          account,
          String(vendor.VendorGroupId ?? '').trim(),
        );
      }
    }
    const getVendorGroup = (line: CashEntryRawDataModel) =>
      vendorGroupByAccount.get(
        String(line.ACCOUNTDISPLAYVALUE).trim().toLowerCase(),
      ) ?? '';
    const isCustodyVendor = (line: CashEntryRawDataModel) =>
      getVendorGroup(line).toLowerCase() === 'custody';
    for (const line of vendorLines) {
      line.VendorGroup = getVendorGroup(line);
    }
    for (const vendorAccount of vendorAccounts) {
      if (!vendorGroupByAccount.get(vendorAccount.toLowerCase())) {
        errors.push(
          `Vendor ${vendorAccount}: vendor group could not be determined from D365FO. Sync vendor master data and retry.`,
        );
      }
    }
    const normalVendorLines = vendorLines.filter(
      (line) => !isCustodyVendor(line),
    );
    const custodyVendorLines = vendorLines.filter(isCustodyVendor);
    for (const line of custodyVendorLines) {
      line.IsCustodyVendor = true;
    }

    const invoices = normalVendorLines
      .map((line) =>
        sanitizeCashOutboundInvoice(
          line.MARKEDINVOICE || line.INVOICE || line.DOCUMENT,
        ),
      )
      .filter(Boolean);
    const existingPairs =
      await this.vendorInvoiceJournalService.findExistingInvoiceVendorPairs(
        this.company,
        invoices,
      );
    for (const line of normalVendorLines) {
      const invoice = sanitizeCashOutboundInvoice(
        line.MARKEDINVOICE || line.INVOICE || line.DOCUMENT,
      );
      const vendor = String(line.ACCOUNTDISPLAYVALUE ?? '').trim();
      if (!invoice) {
        errors.push(
          `Line ${line.LINENUMBER}: Vendor Payment invoice is required for vendor ${vendor}.`,
        );
        continue;
      }
      const key = VendorInvoiceJournalService.pairKey(invoice, vendor);
      if (!existingPairs.has(key)) {
        errors.push(
          `Line ${line.LINENUMBER}: vendor invoice ${invoice} was not found in D365 for vendor ${vendor}.`,
        );
      }
    }

    const targetsByLine = new Map<
      CashEntryRawDataModel,
      CustodySettlementTarget
    >();
    for (const line of custodyVendorLines) {
      const target: CustodySettlementTarget = {
        documentNumber: String(line.DOCUMENT ?? '').trim(),
        currency: String(line.CURRENCYCODE ?? '').trim(),
        amount: Math.max(
          Math.abs(Number(line.DEBITAMOUNT ?? 0)),
          Math.abs(Number(line.CREDITAMOUNT ?? 0)),
        ),
        operationNumber: firstCashFinancialTag(line.FINTAGDISPLAYVALUE),
      };
      const missing = [
        !target.documentNumber ? 'Document Number' : '',
        !target.currency ? 'Currency' : '',
        !target.amount ? 'Amount' : '',
        !target.operationNumber ? 'Operation Number' : '',
      ].filter(Boolean);
      if (missing.length) {
        errors.push(
          `Line ${line.LINENUMBER}: custody settlement target is missing ${missing.join(', ')}.`,
        );
      } else {
        targetsByLine.set(line, target);
      }
    }

    if (targetsByLine.size === 0) return;
    if (!this.generalJournalService) {
      throw new Error('GeneralJournalService is not configured');
    }
    const matches =
      await this.generalJournalService.findCustodySettlementTargets(
        this.company,
        [...targetsByLine.values()],
      );
    for (const [line, target] of targetsByLine) {
      const key = GeneralJournalService.custodySettlementTargetKey(target);
      const targetMatches = matches.get(key) ?? [];
      if (targetMatches.length !== 1) {
        errors.push(
          `Line ${line.LINENUMBER}: expected exactly one custody ledger transaction for document ${target.documentNumber}, currency ${target.currency}, amount ${target.amount}, operation ${target.operationNumber}; found ${targetMatches.length}.`,
        );
      } else if (!line.MARKEDINVOICE) {
        const match = targetMatches[0];
        line.MARKEDINVOICE = sanitizeCashOutboundInvoice(
          match.Invoice || match.Voucher || match.Document || line.INVOICE,
        );
      }
    }
  }

  /**
   * When the source file has no UniqueId column (all values are 0),
   * derive UniqueId from the VOUCHER field so that lines sharing
   * the same voucher are grouped together by buildUniqueIdMap.
   */
  protected assignMissingUniqueIds(lines: CashEntryRawDataModel[]): void {
    const hasMissing = lines.some((l) => !l.UniqueId);
    if (!hasMissing) return;

    const voucherToId = new Map<string, number>();
    let nextId = 1;

    for (const line of lines) {
      if (line.UniqueId) continue;

      const voucher = (line.VOUCHER || '').trim();
      if (!voucher) {
        // No voucher either — assign a unique id per line
        line.UniqueId = nextId++;
        continue;
      }

      if (!voucherToId.has(voucher)) {
        voucherToId.set(voucher, nextId++);
      }
      line.UniqueId = voucherToId.get(voucher)!;
    }

    this.logger.debug(
      `[STEP 1] Assigned UniqueIds to ${lines.filter((l) => l.UniqueId > 0).length} lines from ${voucherToId.size} vouchers`,
    );
  }

  protected getJournalName(safeType?: string): string {
    return resolveCashJournalName({
      inbound: this.isInbound(),
      trucking: this.isTrucking(),
      safeType,
      resolveRoute: (routeSafeType) =>
        this.resolveCashOutJournalRoute(routeSafeType),
    });
  }

  protected resolveCashOutJournalRoute(
    safeType?: string,
  ): CashJournalRoute | undefined {
    if (!safeType) return undefined;
    try {
      return this.cashJournalRoutingService.resolve({
        safeType,
        targetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
      });
    } catch {
      // Validation records the unsupported Safe Type on the formatted line.
      return undefined;
    }
  }

  protected getCollectionDescriptionLabel(): string {
    return getCashCollectionDescriptionLabel(this.isTrucking());
  }

  protected processCustodySettlementLines(
    lines: CashEntryRawDataModel[],
  ): void {
    if (lines.length === 0) return;

    const command = new ProcessCustodySettlementEntryCommand(
      this.company,
      undefined,
      lines,
    );

    this.commandBus
      .execute(command)
      .then(() => {
        this.logger.debug(
          `[STEP 2.5] Successfully processed ${lines.length} custody settlement lines`,
        );
      })
      .catch((error) => {
        this.logger.error(
          `[STEP 2.5] Error processing custody settlement entry for ${lines.length} lines: ${error}`,
        );
      });
  }

  protected processVendorPaymentLines(lines: CashEntryRawDataModel[]): void {
    if (lines.length === 0) return;

    const command = this.isTrucking()
      ? new ProcessVendorPaymentTruckingCommand(this.company, undefined, lines)
      : new ProcessVendorPaymentFreightCommand(this.company, undefined, lines);

    this.commandBus
      .execute(command)
      .then(() => {
        this.logger.debug(
          `[STEP 2.5] Successfully processed ${lines.length} vendor payment lines`,
        );
      })
      .catch((error) => {
        this.logger.error(
          `[STEP 2.5] Error processing vendor payment entry for ${lines.length} lines: ${error}`,
        );
      });
  }

  /**
   * Cash-Out balance validation uses the same official per-file D365 snapshot
   * as journal creation. If any source line has no period, the specific
   * ExchangeRate validation is emitted later and a misleading secondary
   * UnbalancedInvoice error is suppressed.
   */
  protected checkInvoiceBalancedAfterFx(
    invoiceMap: Map<string, EntryRawDataModel[]>,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): Set<string> {
    if (!exchangeRateContext) {
      return super.checkInvoiceBalancedAfterFx(invoiceMap);
    }

    this.unbalancedUniqueIds.clear();

    for (const [uniqueId, lines] of invoiceMap) {
      let totalDebit = 0;
      let totalCredit = 0;
      let canEvaluateBalance = true;

      for (const line of lines) {
        const resolution = this.resolveCashOutExchangeRate(
          exchangeRateContext,
          line.TRANSDATE,
          line.CURRENCYCODE,
        );

        if (resolution.kind === 'missing') {
          canEvaluateBalance = false;
          break;
        }

        const fxRate =
          resolution.kind === 'not-required' ? 1 : resolution.rate / 100;
        totalDebit += Number(line.DEBITAMOUNT || 0) * fxRate;
        totalCredit += Number(line.CREDITAMOUNT || 0) * fxRate;
      }

      if (canEvaluateBalance && Math.abs(totalDebit - totalCredit) > 0.01) {
        this.unbalancedUniqueIds.add(uniqueId);
      }
    }

    return this.unbalancedUniqueIds;
  }

  protected buildInvoiceLines(
    invoiceMap: RawDataInvoiceMap,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const dfoLines: CashEntryDynDataModel[] = [];

    for (const [sourceId, lines] of invoiceMap.entries()) {
      dfoLines.push(...this.buildLines(sourceId, lines, exchangeRateContext));
    }

    return dfoLines;
  }

  protected buildLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    if (!this.isInbound()) {
      const safeTypes = new Set(lines.map((line) => line.SafeType));
      if (safeTypes.size === 1 && lines[0]?.IsVendorPayment) {
        return this.buildVendorPaymentLines(
          sourceId,
          lines,
          exchangeRateContext,
        );
      }

      // Every non-Vendor-Payment SafeType keeps the original debit/credit
      // rows. Only Vendor Payment converts a source counterpart into Offset.
      return lines.map((line) =>
        this.buildSourceLineOutbound(sourceId, line, exchangeRateContext),
      );
    }

    const invoiceLines: CashEntryDynDataModel[] = [];
    const invoiceLineCount = lines.length;

    switch (invoiceLineCount) {
      case 2:
        invoiceLines.push(
          ...this.caseTwoLines(sourceId, lines, exchangeRateContext),
        );
        break;
      default:
        invoiceLines.push(
          ...this.caseMoreThanTwoLines(sourceId, lines, exchangeRateContext),
        );
    }

    return invoiceLines;
  }

  protected buildVendorPaymentLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const withholdingLines = lines.filter((line) =>
      isCashWithholdingLedgerLine(line),
    );
    const vendorLines = lines.filter(
      (line) => line.IsVendor && Number(line.DEBITAMOUNT) > 0,
    );
    const offsetLines = lines.filter(
      (line) =>
        Number(line.CREDITAMOUNT) > 0 && !isCashWithholdingLedgerLine(line),
    );

    if (vendorLines.length === 0 || offsetLines.length !== 1) {
      const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: 'Vendor Payment',
      });
      invalid.AddError(
        'InvalidMapping',
        `Vendor Payment requires one payment offset and one or more debit Vendor lines. Found ${vendorLines.length} Vendor line(s) and ${offsetLines.length} payment offset(s).`,
      );
      return [invalid];
    }

    const paymentOffset = offsetLines[0];
    const vendorGroups = new Map<string, CashEntryRawDataModel[]>();
    for (const vendorLine of vendorLines) {
      const key = [
        String(vendorLine.ACCOUNTDISPLAYVALUE ?? '')
          .trim()
          .toLowerCase(),
        String(vendorLine.VendorGroup ?? '')
          .trim()
          .toLowerCase(),
      ].join('|');
      if (!vendorGroups.has(key)) {
        vendorGroups.set(key, []);
      }
      vendorGroups.get(key)!.push(vendorLine);
    }

    return [...vendorGroups.values()].map((groupLines) =>
      this.buildLineOutbound(
        sourceId,
        groupLines[0],
        paymentOffset,
        'ACCOUNT',
        exchangeRateContext,
        groupLines.map((vendorLine) => ({
          vendorLine,
          withholdingLine: this.findWithholdingLine(
            vendorLine,
            withholdingLines,
          ),
        })),
      ),
    );
  }

  private findWithholdingLine(
    vendorLine: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
  ): CashEntryRawDataModel | undefined {
    const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
    if (invoice) {
      const invoiceMatch = withholdingLines.find(
        (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
      );
      if (invoiceMatch) return invoiceMatch;
    }

    const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
    return withholdingLines.find(
      (line) =>
        line.DOCUMENT === vendorLine.DOCUMENT &&
        line.CURRENCYCODE === vendorLine.CURRENCYCODE &&
        firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
    );
  }

  protected caseTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    let accountLine: CashEntryRawDataModel | undefined;
    let offsetLine: CashEntryRawDataModel | undefined;

    if (this.isInbound()) {
      accountLine = lines.find((l) => l.IsCustomer);
      offsetLine = lines.find((l) => !l.IsCustomer);
    } else {
      accountLine = lines.find((l) => l.DEBITAMOUNT > 0);
      offsetLine = lines.find((l) => l.CREDITAMOUNT > 0);
    }

    return [
      this.buildLine(
        sourceId,
        accountLine,
        offsetLine,
        undefined,
        exchangeRateContext,
      ),
    ];
  }

  protected caseMoreThanTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    let accountLines: CashEntryRawDataModel[] = [];
    let offsetLines: CashEntryRawDataModel[] = [];

    if (this.isInbound()) {
      accountLines = lines.filter((l) => l.IsCustomer);
      offsetLines = lines.filter((l) => !l.IsCustomer);

      const accountLinesLength = accountLines.length;
      const offsetLinesLength = offsetLines.length;
      const settlementSink: CashEntryRawDataModel[] = [];

      if (accountLinesLength > 1 && offsetLinesLength === 1) {
        return accountLines.map((accLine) =>
          this.buildLine(
            sourceId,
            accLine,
            offsetLines[0],
            'ACCOUNT',
            exchangeRateContext,
          ),
        );
      }

      if (accountLinesLength === 1 && offsetLinesLength > 1) {
        const withoutSettlementOffsetLines = filterCashSettlementLines(
          offsetLines,
          settlementSink,
          (displayValue) =>
            this.utilsService.parseDimensionString(displayValue),
        );

        return withoutSettlementOffsetLines.map((offLine) =>
          this.buildLine(
            sourceId,
            accountLines[0],
            offLine,
            'OFFSET',
            exchangeRateContext,
          ),
        );
      }

      return [
        this.buildLine(
          sourceId,
          undefined,
          undefined,
          undefined,
          exchangeRateContext,
        ),
      ];
    } else {
      accountLines = lines.filter((l) => l.DEBITAMOUNT > 0);
      offsetLines = lines.filter((l) => l.CREDITAMOUNT > 0);

      const accountLinesLength = accountLines.length;
      const offsetLinesLength = offsetLines.length;
      const settlementSink: CashEntryRawDataModel[] = [];

      if (accountLinesLength > 1 && offsetLinesLength === 1) {
        return accountLines.map((accLine) =>
          this.buildLine(
            sourceId,
            accLine,
            offsetLines[0],
            'ACCOUNT',
            exchangeRateContext,
          ),
        );
      }

      if (accountLinesLength === 1 && offsetLinesLength > 1) {
        const withoutSettlementOffsetLines = filterCashSettlementLines(
          offsetLines,
          settlementSink,
          (displayValue) =>
            this.utilsService.parseDimensionString(displayValue),
        );

        return withoutSettlementOffsetLines.map((offLine) =>
          this.buildLine(
            sourceId,
            accountLines[0],
            offLine,
            'OFFSET',
            exchangeRateContext,
          ),
        );
      }

      return [
        this.buildLine(
          sourceId,
          undefined,
          undefined,
          undefined,
          exchangeRateContext,
        ),
      ];
    }
  }

  protected buildLine(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel {
    return this.isInbound()
      ? this.buildLineInbound(
          sourceId,
          accountLine,
          offsetLine,
          amountSource ?? 'OFFSET',
          exchangeRateContext,
        )
      : this.buildLineOutbound(
          sourceId,
          accountLine,
          offsetLine,
          amountSource ?? 'OFFSET',
          exchangeRateContext,
        );
  }

  protected buildLineInbound(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel {
    const dimensionString =
      offsetLine?.ACCOUNTTYPE === 'Ledger'
        ? offsetLine?.ACCOUNTDISPLAYVALUE
        : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;

    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    let dimensions = this.utilsService.parseDimensionString(dimensionString);
    dimensions = isCash22420LedgerDimensionLine(accountLine, offsetLine)
      ? this.utilsService.filterDimensionsForLedgerTag22420(dimensions)
      : dimensions;

    if (!accountLine || !offsetLine) {
      const line = new CashEntryDynDataModel(dimensions, {
        SourceIds: [sourceId],
      });

      if (!accountLine) {
        line.AddError('InvalidMapping', 'No account line found');
      }
      if (!offsetLine) {
        line.AddError('InvalidMapping', 'No offset line found');
      }

      return line;
    }

    if (dimensions.mainAccount === '123510') {
      dimensions.mainAccount = '122204';
    }

    const isNotesReceivable = isCashNotesReceivableLine(
      offsetLine,
      dimensions.mainAccount,
    );

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = getCashCollectionDescriptionLabel(this.isTrucking());
    const description = `Customer Collection - ${label} ${formattedDate} (${accountLine.VoucherType})`;

    const paymentReference = isNotesReceivable
      ? offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`
      : offsetLine.DESCRIPTION || '';

    const dimensionStr = toCashDefaultDimensionDisplayValue(
      dimensions,
      !isCash22420LedgerDimensionLine(accountLine, offsetLine),
    );

    const currencyCode =
      amountSource === 'ACCOUNT'
        ? accountLine.CURRENCYCODE
        : offsetLine.CURRENCYCODE;

    const transactionDate = offsetLine.TRANSDATE || accountLine.TRANSDATE;

    const officialReportingResolution = exchangeRateContext
      ? this.cashOutExchangeRateService.resolveReporting(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;

    const legacyRates = this.fetchExchangeRates(transactionDate, currencyCode);

    const exchangeRate = legacyRates.exchangeRate;
    const reportingRate = officialReportingResolution
      ? officialReportingResolution.rate
      : legacyRates.reportingRate;

    const markedInvoice = formatCashInboundInvoice(
      accountLine.INVOICE ||
        offsetLine.INVOICE ||
        accountLine.DOCUMENT ||
        offsetLine.DOCUMENT,
    );

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: isNotesReceivable ? 'Bank' : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: resolveCashPaymentMethod(accountLine, offsetLine),
      PaymentReference: paymentReference,
      JournalName: resolveCashJournalName({
        inbound: this.isInbound(),
        trucking: this.isTrucking(),
        resolveRoute: (safeType) => this.resolveCashOutJournalRoute(safeType),
      }),
      TransactionDate: accountLine.TRANSDATE,
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: resolveCashOffsetAccountDisplayValue(
        offsetLine,
        dimensions,
        isNotesReceivable,
        dimensionStr,
      ),
      FinTagDisplayValue: accountLine.FINTAGDISPLAYVALUE,
      OffsetFinTagDisplayValue: accountLine.FINTAGDISPLAYVALUE,
      CreditAmount:
        amountSource === 'ACCOUNT'
          ? accountLine.CREDITAMOUNT
          : offsetLine.DEBITAMOUNT,
      DebitAmount: 0,
      CurrencyCode: currencyCode,
      ExchangeRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      CustomerName: this.getCustomerName(accountLine.ACCOUNTDISPLAYVALUE),
      DefaultDimensionsForAccountDisplayValue: dimensionStr,
      DefaultDimensionsForOffsetAccountDisplayValue: dimensionStr,
      SalesTaxGroup: offsetLine.SALESTAXGROUP,
      ItemSalesTaxGroup: offsetLine.ITEMSALESTAXGROUP,
      ItemWithholdingTaxGroupCode: offsetLine.ITEMWITHHOLDINGTAXGROUPCODE,
      OffsetCompany: this.company,
      PostingProfile:
        accountLine.POSTINGPROFILE?.trim() ||
        offsetLine.POSTINGPROFILE?.trim() ||
        '',
      Invoice: markedInvoice,
      MarkedInvoice: markedInvoice,
      dataAreaId: this.company,
      SecondaryExchangeRate:
        amountSource === 'ACCOUNT'
          ? accountLine.EXCHANGERATESECONDARY
          : offsetLine.EXCHANGERATESECONDARY,
      Document: accountLine.DOCUMENT,
      DocumentDate: accountLine.DOCUMENTDATE,
      DueDate: accountLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: accountLine.SafeType,
      VoucherType: accountLine.VoucherType,
    });

    if (!this.utilsService.isValidDimensionSegmentLength(segmentLength)) {
      dynLine.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${segmentLength}. Expected 19 or 20 segments.`,
      );
    }

    if (exchangeRateContext) {
      this.addCashOutExchangeRateErrors(
        dynLine,
        [accountLine, offsetLine],
        exchangeRateContext,
      );
    }

    return dynLine;
  }

  protected buildLineOutbound(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
    exchangeRateContext?: CashOutExchangeRateContext,
    settlements?: Array<{
      vendorLine: CashEntryRawDataModel;
      withholdingLine?: CashEntryRawDataModel;
    }>,
  ): CashEntryDynDataModel {
    const dimensionString =
      offsetLine?.ACCOUNTTYPE === 'Ledger'
        ? offsetLine?.ACCOUNTDISPLAYVALUE
        : accountLine?.ACCOUNTTYPE === 'Ledger'
          ? accountLine?.ACCOUNTDISPLAYVALUE
          : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;

    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    let dimensions = this.utilsService.parseDimensionString(dimensionString);
    dimensions = isCash22420LedgerDimensionLine(accountLine, offsetLine)
      ? this.utilsService.filterDimensionsForLedgerTag22420(dimensions)
      : dimensions;

    if (!accountLine || !offsetLine) {
      const line = new CashEntryDynDataModel(dimensions, {
        SourceIds: [sourceId],
      });

      if (!accountLine) {
        line.AddError('InvalidMapping', 'No account line found');
      }
      if (!offsetLine) {
        line.AddError('InvalidMapping', 'No offset line found');
      }

      return line;
    }

    if (dimensions.mainAccount === '123510') {
      dimensions.mainAccount = '122204';
    }

    if (
      dimensions.mainAccount &&
      this.MAIN_ACCOUNTS_NP_MAP[Number(dimensions.mainAccount)]
    ) {
      dimensions.mainAccount =
        this.MAIN_ACCOUNTS_NP_MAP[Number(dimensions.mainAccount)].toString();
    }

    const isNotesReceivable = isCashNotesReceivableLine(
      offsetLine,
      dimensions.mainAccount,
    );

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = getCashCollectionDescriptionLabel(this.isTrucking());
    const route = this.resolveCashOutJournalRoute(accountLine.SafeType);

    const paymentReference =
      offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`;

    const dimensionStr = toCashDefaultDimensionDisplayValue(
      dimensions,
      !isCash22420LedgerDimensionLine(accountLine, offsetLine),
    );

    // Currency, date, amount, and official rate must all come from the same
    // split source row. This matters for one-to-many journal groups.
    const amountLine = amountSource === 'ACCOUNT' ? accountLine : offsetLine;
    const fallbackLine = amountSource === 'ACCOUNT' ? offsetLine : accountLine;
    const currencyCode = amountLine.CURRENCYCODE || fallbackLine.CURRENCYCODE;
    const transactionDate = amountLine.TRANSDATE || fallbackLine.TRANSDATE;

    const officialResolution = exchangeRateContext
      ? this.resolveCashOutExchangeRate(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;
    const officialReportingResolution = exchangeRateContext
      ? this.cashOutExchangeRateService.resolveReporting(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;
    const legacyRates = officialResolution
      ? undefined
      : this.fetchExchangeRates(transactionDate, currencyCode);
    const exchangeRate = officialResolution?.rate ?? legacyRates!.exchangeRate;
    const reportingRate = officialReportingResolution
      ? officialReportingResolution.rate
      : officialResolution
        ? 0
        : legacyRates!.reportingRate;

    const normalizedSettlements =
      settlements && settlements.length > 0
        ? settlements
        : [{ vendorLine: accountLine }];
    const markedLines = normalizedSettlements.map(
      ({ vendorLine, withholdingLine }) =>
        this.buildMarkedLine(vendorLine, withholdingLine),
    );
    const primarySettlement = normalizedSettlements[0];
    const isWithholding =
      normalizedSettlements.some(
        ({ vendorLine, withholdingLine }) =>
          String(
            vendorLine.ISWITHHOLDINGCALCULATIONENABLED ?? '',
          ).toLowerCase() === 'yes' ||
          (!!vendorLine.ITEMWITHHOLDINGTAXGROUPCODE &&
            String(vendorLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '' &&
            String(vendorLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '0') ||
          Boolean(withholdingLine),
      ) ||
      String(offsetLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
        'yes' ||
      (!!offsetLine.ITEMWITHHOLDINGTAXGROUPCODE &&
        String(offsetLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '' &&
        String(offsetLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '0') ||
      !!(accountLine as any).hasWithholdingReduction ||
      !!(offsetLine as any).hasWithholdingReduction;

    const rawInvoice =
      primarySettlement.vendorLine.MARKEDINVOICE ||
      offsetLine.MARKEDINVOICE ||
      primarySettlement.vendorLine.INVOICE ||
      offsetLine.INVOICE ||
      primarySettlement.vendorLine.DOCUMENT ||
      offsetLine.DOCUMENT;
    const sanitizedInvoice = sanitizeCashOutboundInvoice(rawInvoice);

    const descriptionSuffix = !sanitizedInvoice ? ' - unmarked' : '';
    const description = `${route?.safeType ?? 'Vendor Payment'} - ${label} ${formattedDate} (${accountLine.VoucherType})${descriptionSuffix}`;

    const salesTaxGroup = offsetLine.SALESTAXGROUP?.trim()?.toLowerCase() || '';
    const itemSalesTaxGroup =
      offsetLine.ITEMSALESTAXGROUP?.trim()?.toLowerCase() || '';
    const isTaxable = salesTaxGroup === 'taxable' && !!itemSalesTaxGroup;

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: isNotesReceivable ? 'Bank' : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: resolveCashPaymentMethod(accountLine, offsetLine),
      PaymentReference: paymentReference,
      OffsetTransactionText: (() => {
        let offsetText = isNotesReceivable
          ? paymentReference
          : offsetLine.DESCRIPTION || '';
        if (descriptionSuffix) {
          if (!offsetText) {
            offsetText = 'unmarked';
          } else if (!offsetText.toLowerCase().includes('unmarked')) {
            offsetText = `${offsetText}${descriptionSuffix}`;
          }
        }
        return offsetText;
      })(),
      JournalName:
        route?.journalName ?? this.getJournalName(accountLine.SafeType),
      TransDate: transactionDate,
      TransactionDate: transactionDate,
      VoucherType: accountLine.VoucherType,
      // Cash-Out: AccountNum = vendor; OffsetAccountDisplayValue = Bank/RCash account id or ledger account.
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: resolveCashOffsetAccountDisplayValue(
        offsetLine,
        dimensions,
        isNotesReceivable,
        dimensionStr,
      ),
      FinTagDisplayValue: this.replaceFinTagShippingLineWithVendorName(
        accountLine.FINTAGDISPLAYVALUE,
      ),
      OffsetFinTagDisplayValue: this.replaceFinTagShippingLineWithVendorName(
        offsetLine.FINTAGDISPLAYVALUE,
      ),
      CreditAmount: 0,
      DebitAmount:
        amountSource === 'ACCOUNT'
          ? normalizedSettlements.reduce(
              (sum, { vendorLine }) =>
                sum + Number(vendorLine.DEBITAMOUNT ?? 0),
              0,
            )
          : offsetLine.CREDITAMOUNT,
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: dimensionStr,
      OffsetDefaultDimensionDisplayValue: dimensionStr,
      SalesTaxGroup: isTaxable ? 'Taxable' : 'Non-Taxabl',
      ItemSalesTaxGroup: itemSalesTaxGroup,
      IsWithholdingCalculationEnabled: isWithholding ? 'Yes' : 'No',
      ItemWithholdingTaxGroupCode:
        primarySettlement.vendorLine.ITEMWITHHOLDINGTAXGROUPCODE ||
        primarySettlement.withholdingLine?.ITEMWITHHOLDINGTAXGROUPCODE ||
        offsetLine.ITEMWITHHOLDINGTAXGROUPCODE,
      OffsetCompany: this.company,
      PostingProfile:
        accountLine.POSTINGPROFILE?.trim() ||
        offsetLine.POSTINGPROFILE?.trim() ||
        '',
      Invoice: sanitizeCashOutboundInvoice(rawInvoice),
      MarkedInvoice: sanitizedInvoice,
      MarkedLines: markedLines,
      VendorGroup: accountLine.VendorGroup ?? '',
      dataAreaId: this.company,
      // Excel exchange-rate fields (including secondary/reporting variants)
      // are intentionally ignored for Cash-Out.
      ExchRateSecond: 0,
      Document: accountLine.DOCUMENT,
      DocumentDate: accountLine.DOCUMENTDATE,
      DueDate: accountLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: accountLine.SafeType,
      SettlementTargetType: accountLine.IsCustodyVendor
        ? 'CustodyLedger'
        : 'VendorInvoice',
    });

    if (!this.utilsService.isValidDimensionSegmentLength(segmentLength)) {
      dynLine.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${segmentLength}. Expected 19 or 20 segments.`,
      );
    }

    if (exchangeRateContext) {
      this.addCashOutExchangeRateErrors(
        dynLine,
        [accountLine, offsetLine],
        exchangeRateContext,
      );
    }

    return dynLine;
  }

  protected buildSourceLineOutbound(
    sourceId: string,
    sourceLine: CashEntryRawDataModel,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel {
    const dimensionString =
      sourceLine.ACCOUNTTYPE === 'Ledger'
        ? sourceLine.ACCOUNTDISPLAYVALUE
        : sourceLine.DEFAULTDIMENSIONDISPLAYVALUE;
    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    let dimensions = this.utilsService.parseDimensionString(dimensionString);
    const is22420LedgerLine = isCash22420LedgerDimensionLine(
      sourceLine,
      undefined,
    );
    dimensions = isCash22420LedgerDimensionLine(sourceLine, undefined)
      ? this.utilsService.filterDimensionsForLedgerTag22420(dimensions)
      : dimensions;

    if (dimensions.mainAccount === '123510') {
      dimensions.mainAccount = '122204';
    }
    if (
      dimensions.mainAccount &&
      this.MAIN_ACCOUNTS_NP_MAP[Number(dimensions.mainAccount)]
    ) {
      dimensions.mainAccount =
        this.MAIN_ACCOUNTS_NP_MAP[Number(dimensions.mainAccount)].toString();
    }

    const route = this.resolveCashOutJournalRoute(sourceLine.SafeType);
    const transactionDate = sourceLine.TRANSDATE;
    const currencyCode = sourceLine.CURRENCYCODE;
    const officialResolution = exchangeRateContext
      ? this.resolveCashOutExchangeRate(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;
    const officialReportingResolution = exchangeRateContext
      ? this.cashOutExchangeRateService.resolveReporting(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;
    const legacyRates = officialResolution
      ? undefined
      : this.fetchExchangeRates(transactionDate, currencyCode);
    const exchangeRate = officialResolution?.rate ?? legacyRates!.exchangeRate;
    const reportingRate = officialReportingResolution
      ? officialReportingResolution.rate
      : officialResolution
        ? 0
        : legacyRates!.reportingRate;

    const offsetDimensionString =
      sourceLine.OFFSETACCOUNTTYPE === 'Ledger'
        ? sourceLine.OFFSETACCOUNTDISPLAYVALUE
        : sourceLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE;
    const offsetDimensions = this.utilsService.parseDimensionString(
      offsetDimensionString,
    );
    const description = `${route?.safeType ?? sourceLine.SafeType} - ${getCashCollectionDescriptionLabel(this.isTrucking())} ${this.utilsService.formatMonthYear(sourceLine.TRANSDATE)}${sourceLine.VoucherType ? ` (${sourceLine.VoucherType})` : ''}`;
    const isCustodySettlement = route?.safeType === 'Custody Settlement';
    const sourceHasWithholding =
      isCashWithholdingLedgerLine(sourceLine) ||
      String(sourceLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
        'yes' ||
      Boolean(sourceLine.ITEMWITHHOLDINGTAXGROUPCODE);

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: sourceLine.TEXT || description,
      Company: this.company,
      AccountType: sourceLine.ACCOUNTTYPE,
      OffsetAccountType: sourceLine.OFFSETACCOUNTTYPE,
      PaymentMethodName: sourceLine.PAYMENTMETHOD,
      PaymentReference: sourceLine.PAYMENTREFERENCE,
      OffsetTransactionText: sourceLine.OFFSETTEXT,
      JournalName:
        route?.journalName ?? this.getJournalName(sourceLine.SafeType),
      TransDate: transactionDate,
      TransactionDate: transactionDate,
      VoucherType: sourceLine.VoucherType,
      AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: sourceLine.OFFSETACCOUNTDISPLAYVALUE,
      FinTagDisplayValue: this.replaceFinTagShippingLineWithVendorName(
        sourceLine.FINTAGDISPLAYVALUE,
      ),
      OffsetFinTagDisplayValue: this.replaceFinTagShippingLineWithVendorName(
        sourceLine.OFFSETFINTAGDISPLAYVALUE,
      ),
      CreditAmount: sourceLine.CREDITAMOUNT,
      DebitAmount: sourceLine.DEBITAMOUNT,
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: toCashDefaultDimensionDisplayValue(
        dimensions,
        !is22420LedgerLine,
      ),
      OffsetDefaultDimensionDisplayValue: offsetDimensionString
        ? toCashDefaultDimensionDisplayValue(offsetDimensions, true)
        : '',
      SalesTaxGroup: sourceLine.SALESTAXGROUP,
      ItemSalesTaxGroup: sourceLine.ITEMSALESTAXGROUP,
      IsWithholdingCalculationEnabled:
        isCustodySettlement && sourceHasWithholding ? 'Yes' : 'No',
      ItemWithholdingTaxGroupCode: isCustodySettlement
        ? sourceLine.ITEMWITHHOLDINGTAXGROUPCODE
        : '',
      OffsetCompany: this.company,
      PostingProfile: sourceLine.POSTINGPROFILE,
      Invoice: sanitizeCashOutboundInvoice(
        sourceLine.INVOICE || sourceLine.DOCUMENT,
      ),
      MarkedInvoice: '',
      dataAreaId: this.company,
      ExchRateSecond: 0,
      Document: sourceLine.DOCUMENT,
      DocumentDate: sourceLine.DOCUMENTDATE,
      DueDate: sourceLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: route?.safeType ?? sourceLine.SafeType,
    });

    if (
      dimensionString &&
      !this.utilsService.isValidDimensionSegmentLength(segmentLength)
    ) {
      dynLine.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${segmentLength}. Expected 19 or 20 segments.`,
      );
    }

    if (sourceHasWithholding && !isCustodySettlement) {
      dynLine.AddError(
        'Withholding',
        `Withholding is not supported for SafeType ${route?.safeType ?? sourceLine.SafeType}.`,
      );
    }

    if (exchangeRateContext) {
      this.addCashOutExchangeRateErrors(
        dynLine,
        [sourceLine],
        exchangeRateContext,
      );
    }

    return dynLine;
  }

  private resolveCashOutExchangeRate(
    context: CashOutExchangeRateContext,
    transactionDate: string,
    currencyCode: string,
  ): CashOutExchangeRateResolution {
    if (!this.cashOutExchangeRateService) {
      throw new Error('CashOutExchangeRateService is not configured');
    }

    return this.cashOutExchangeRateService.resolve(
      context,
      transactionDate,
      currencyCode,
    );
  }

  private addCashOutExchangeRateErrors(
    dynLine: CashEntryDynDataModel,
    sourceLines: CashEntryRawDataModel[],
    context: CashOutExchangeRateContext,
  ): void {
    const checked = new Set<string>();

    for (const sourceLine of sourceLines) {
      if (!sourceLine?.CURRENCYCODE || !sourceLine?.TRANSDATE) continue;
      const key = `${sourceLine.CURRENCYCODE.trim().toUpperCase()}|${sourceLine.TRANSDATE}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const resolution = this.resolveCashOutExchangeRate(
        context,
        sourceLine.TRANSDATE,
        sourceLine.CURRENCYCODE,
      );

      if (resolution.kind === 'missing') {
        dynLine.AddError('ExchangeRate', resolution.message);
      }

      const reportingResolution =
        this.cashOutExchangeRateService.resolveReporting(
          context,
          sourceLine.TRANSDATE,
          sourceLine.CURRENCYCODE,
        );

      if (reportingResolution.kind === 'missing') {
        dynLine.AddError('ExchangeRate', reportingResolution.message);
      }
    }
  }

  /**
   * Cash-out: replace FinTag shippingLine (index 2) vendor account code
   * (e.g. Al-000021) with vendorOrganizationName (e.g. Turkish Airlines).
   * Leaves the segment unchanged when no vendor name is found.
   */
  protected replaceFinTagShippingLineWithVendorName(
    finTagDisplayValue?: string,
  ): string {
    return replaceCashShippingLineWithVendorName(
      finTagDisplayValue,
      (vendorAccount) => this.getVendorName(vendorAccount),
    );
  }

  /**
   * Cash API default-dimension display value: no mainAccount, fixed segment order.
   * Override lives on cash base only (not EntryProcessorBase).
   */
  /**
   * Bank / RCash (Petty cash) → FO account id from source ACCOUNTDISPLAYVALUE
   * (e.g. "PSD EG", "AAIB-EG-CA"), never the dimension string.
   * Ledger → full ledger account display value.
   * Notes-receivable forced to Bank → bankAccount dim segment when present.
   */
  /**
   * PAYMENTMETHODNAME is source-owned: use the Excel PAYMENTMETHOD value from
   * the transaction row, then the paired row, and never derive it from an
   * account type such as Petty cash/RCash.
   */
  /**
   * One batched FO lookup for all cash-out marked invoices → in-memory Set.
   * Validation is then sync from the Set (no per-line FO calls).
   */
  protected async fetchVendorInvoiceExistsMap(
    lines: CashEntryDynDataModel[],
  ): Promise<void> {
    const invoices = [
      ...new Set(
        lines
          .filter((line) => {
            try {
              return (
                this.cashJournalRoutingService.resolve({
                  safeType: line.SafeType,
                  targetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
                  voucherType: line.VoucherType,
                }).kind === 'vendor-invoice'
              );
            } catch {
              // Unsupported Safe Types are reported by validateAsync.
              return false;
            }
          })
          .flatMap((line) =>
            (line.MarkedLines?.length
              ? line.MarkedLines.map((markedLine) => markedLine.InvoiceNumber)
              : [line.MarkedInvoice || line.Invoice || '']
            ).map((invoice) => String(invoice).trim()),
          )
          .filter((invoice) => Boolean(invoice)),
      ),
    ];

    if (invoices.length === 0) {
      this.vendorInvoiceExistsMap = new Set();
      this.logger.debug(
        '[LOOKUP] No cash-out marked invoices to resolve; skipping VendInvoiceJournalLines lookup',
      );
      return;
    }

    this.vendorInvoiceExistsMap =
      await this.vendorInvoiceJournalService.findExistingInvoiceVendorPairs(
        this.company,
        invoices,
      );
  }

  /**
   * Sync cash-out MarkedInvoice check using the preloaded pair Set.
   * Empty MarkedInvoice = payment without settle (allowed).
   */
  protected validateCashOutMarkedInvoice(line: CashEntryDynDataModel): void {
    if (!this.vendorInvoiceExistsMap) {
      throw new Error(
        'fetchVendorInvoiceExistsMap must be called before validateCashOutMarkedInvoice',
      );
    }

    const vendorAccount = (line.AccountDisplayValue || '').trim();
    if (!vendorAccount) {
      line.AddError(
        'MarkedInvoice',
        'Vendor account is missing for invoice settlement.',
      );
      return;
    }

    const invoices = line.MarkedLines?.length
      ? line.MarkedLines.map((markedLine) => markedLine.InvoiceNumber)
      : [line.MarkedInvoice || ''];
    for (const invoiceValue of invoices) {
      const invoice = String(invoiceValue ?? '').trim();
      if (!invoice) continue;

      const key = VendorInvoiceJournalService.pairKey(invoice, vendorAccount);
      if (!this.vendorInvoiceExistsMap.has(key)) {
        line.AddError(
          'MarkedInvoice',
          `Vendor invoice ${invoice} was not found in D365 for vendor ${vendorAccount}.`,
        );
      }
    }
  }

  protected buildMarkedLine(
    vendorLine: CashEntryRawDataModel,
    withholdingLine?: CashEntryRawDataModel,
  ): {
    InvoiceNumber: string;
    OperationNumber: string;
    DocumentNumber: string;
    HasWithHoldingLine: boolean;
  } {
    const vendorGroup = String(vendorLine.VendorGroup ?? '').trim();
    const isCustody = vendorGroup.toLowerCase() === 'custody';

    return {
      InvoiceNumber: isCustody
        ? ''
        : sanitizeCashOutboundInvoice(
            vendorLine.MARKEDINVOICE ||
              vendorLine.INVOICE ||
              vendorLine.DOCUMENT,
          ),
      OperationNumber: firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE),
      DocumentNumber: isCustody ? String(vendorLine.DOCUMENT ?? '').trim() : '',
      HasWithHoldingLine: Boolean(withholdingLine),
    };
  }

  protected formatInvoiceInbound(invoice?: string): string {
    const trimmedInvoice = invoice?.trim();
    if (!trimmedInvoice) return '';

    const parts = trimmedInvoice.split('/');

    const numberPart = parts[0]?.trim();
    const textLower = parts[1]?.trim()?.toLowerCase() ?? '';

    const number = parseInt(numberPart, 10);
    if (isNaN(number)) return '';

    const REJECTED_NUMBERS = [
      '0',
      '00',
      '000',
      '0000',
      '00000',
      '000000',
      '0000000',
      '00000000',
      '000000000',
      '0000000000',
    ];
    if (REJECTED_NUMBERS.includes(number.toString())) return '';

    let newTextPart: string = parts[1]?.trim();

    if (/نولون/.test(textLower)) {
      newTextPart = 'OF-FW';
    }

    const invoicePatterns = [
      /\bimport\b.*\bstore\b|\bstore\b.*\bimport\b/,
      /\bimport\b.*\bstor\b|\bstor\b.*\bimport\b/,
      /\bdekheila\b.*\bstorage\b|\bstorage\b.*\bdekheila\b/,
    ];
    if (invoicePatterns.some((re) => re.test(textLower))) {
      newTextPart = 'INVOICE';
    }

    const lowercasedTextPart = newTextPart?.toLowerCase();
    const suffix =
      lowercasedTextPart === 'invoice'
        ? capitalize(newTextPart)
        : newTextPart?.toUpperCase();

    return `${number.toString().padStart(9, '0')}/${suffix}`;
  }

  protected formatInvoiceOutbound(invoice?: string): string {
    const trimmedInvoice = invoice?.trim();
    if (!trimmedInvoice) return '';

    const parts = trimmedInvoice.split('/');

    const numberPart = parts[0]?.trim();
    let textPart = parts[1]?.trim()?.toLowerCase();

    const number = parseInt(numberPart, 10);
    if (isNaN(number)) return '';

    if (textPart.includes('نولون')) {
      textPart = 'OF-FW';
    }

    if (textPart.includes('import') && textPart.includes('store')) {
      textPart = 'INVOICE';
    }

    if (textPart.includes('dekheila') && textPart.includes('storage')) {
      textPart = 'INVOICE';
    }

    return `${number.toString().padStart(9, '0')}/${textPart.toUpperCase()}`;
  }

  /**
   * Identify withholding 223304 source lines for stats and later routing.
   * Lines are kept unchanged — the vendor line retains its full amount
   * (invoice + tax). Vendor Payment absorbs the 223304 amount into its gross
   * vendor line, while Custody Settlement keeps it as an independent line.
   */
  protected applyWithholdingReductions(lines: CashEntryRawDataModel[]): {
    lines: CashEntryRawDataModel[];
    stats: {
      withholdingRemovedCount: number;
      withholdingRemovedAmount: number;
    };
  } {
    const stats = analyzeCashWithholding(lines);
    if (stats.withholdingRemovedCount > 0) {
      this.logger.debug(
        `[WITHHOLDING] Found ${stats.withholdingRemovedCount} source lines on 223304 (total amount: ${stats.withholdingRemovedAmount}); treatment depends on SafeType.`,
      );
    }
    return { lines, stats };
  }
}
