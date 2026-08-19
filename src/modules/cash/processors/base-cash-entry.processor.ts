import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  CashInCustomerFxSpecialCaseResult,
  evaluateCashInCustomerFxGroup,
  extractCashInMainAccount,
  normalizeCashInAccountType,
  parseCashInCustomerInvoices,
} from './cash-in-customer-fx.rules';

import { capitalize } from '@/lib/utils';
import { ProcessCashOutFreightCommand } from '@/modules/cash/commands/process-cash-out-freight.command';
import { ProcessCashOutTruckingCommand } from '@/modules/cash/commands/process-cash-out-trucking.command';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  CashInSafeTypeRoutingFailure,
  CashInSafeTypeRoutingService,
} from '@/modules/cash/services/cash-in-safetype-routing.service';
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

/**
 * Cash custom APIs expect default dimensions without mainAccount, in this order
 * (no leading empty/`|` separator for mainAccount).
 */
const CASH_API_DIMENSION_FIELDS: Array<keyof EntryDimensionsModel> = [
  'costCenter',
  'activityName',
  'businessUnit',
  'location',
  'customer',
  'subCustomer',
  'vendor',
  'subVendor',
  'chargeType',
  'salesMan',
  'coordinatorMan',
  'freightType',
  'truckerType',
  'truckNumber',
  'direction',
  'worker',
  'fixedAsset',
  'lease',
  'bankAccount',
];

/** FinTag segment index for shippingLine (operationNo|quotationNo|shippingLine|...). */
const FINTAG_SHIPPING_LINE_INDEX = 2;

@Injectable()
export abstract class BaseCashEntryProcessor extends EntryProcessorBase {
  protected readonly logger = new Logger(BaseCashEntryProcessor.name);
  private readonly cashJournalRoutingService = new CashJournalRoutingService();
  private readonly cashInSafeTypeRoutingService =
    new CashInSafeTypeRoutingService(this.cashJournalRoutingService);
  private readonly cashOutExchangeRateService: CashOutExchangeRateService;
  private readonly generalJournalService: GeneralJournalService;
  private readonly d365VendorService?: VendorService;

  protected readonly MAX_LINES_PER_BATCH = 1000;

  /**
   * Cash-out: Set of `invoice|vendorAccount` keys that exist on
   * Posted D365 vendor invoice records (filled once per enrich via batched FO lookup).
   */
  protected vendorInvoiceExistsMap: Set<string> | null = null;

  /**
   * Cash-In special case: customer FX matching + Ledger 421103 skip results
   * keyed by UniqueId. Reset at the start of each formatAndEnrichAsync.
   */
  private cashInCustomerFxResults = new Map<
    string,
    CashInCustomerFxSpecialCaseResult
  >();

  /**
   * UniqueId groups that failed SafeType / TargetProcessor routing and must
   * not enter Cash-In or Cash-Out journal construction.
   */
  private cashInSafeTypeRoutingFailures: CashInSafeTypeRoutingFailure[] = [];

  /**
   * Cash-In balance failures keyed as `uniqueId|moneyType` (VoucherType).
   * Used so only the unbalanced money-type lines of a UniqueId are blocked.
   */
  private unbalancedCashInMoneyTypeKeys: Set<string> = new Set();

  protected readonly NOTES_RECEIVABLE_MAIN_ACCOUNTS = [
    '122201',
    '122202',
    '122203',
    '122204',
    '123510',
  ];

  protected readonly SETTLEMENT_MAIN_ACCOUNTS = ['421103'];

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
    const rawLines = this.mapToModel(data);
    this.assignMissingUniqueIds(rawLines);
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
      const result = this.applyWithholdingReductions(sortedLines);
      processedLines = result.lines;
      withholdingStats = result.stats;
    }

    if (this.isInbound()) {
      // SafeType routing must run before Cash-In FX / 421103 transforms so
      // Custody Settlement UniqueIds never enter customer-collection rules.
      processedLines =
        await this.routeCashInCustodySettlementToCashOut(processedLines);
      processedLines =
        this.applyCashInCustomerForeignCurrencyRules(processedLines);
    }

    this.logger.debug(
      `[STEP 2] Filtering lines from ${processedLines.length} lines${this.isInbound() ? ' (cash-in splits custody)' : ' (cash-out keeps all)'}`,
    );
    const { custodySettlementLines, otherLines, vendorPayment } =
      this.filterLines(processedLines);
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
        `[STEP 6] Batch-looking up posted vendor invoices in D365 for ${updatedDfoLines.length} lines`,
      );
      await this.fetchVendorInvoiceExistsMap(updatedDfoLines);
      this.logger.debug(
        `[STEP 6] Vendor invoice pair map size: ${this.vendorInvoiceExistsMap?.size ?? 0}`,
      );
    }

    // Leftover custody lines are a safety net only — primary routing happens
    // before Cash-In transforms via routeCashInCustodySettlementToCashOut.
    if (custodySettlementLines.length > 0) {
      this.logger.debug(
        `[STEP 7] Routing ${custodySettlementLines.length} leftover custody settlement lines to Cash-Out`,
      );
      await this.processCustodySettlementLines(custodySettlementLines);
    }

    if (!this.isInbound()) {
      this.logger.debug(
        `[STEP 7] Processing ${vendorPayment.length} vendor payment lines`,
      );
      this.processVendorPaymentLines(vendorPayment);
    }

    if (withholdingStats) {
      (updatedDfoLines as any).metadata = withholdingStats;
    }

    if (this.isInbound() && this.cashInSafeTypeRoutingFailures.length > 0) {
      updatedDfoLines.push(
        ...this.buildCashInSafeTypeRoutingFailureLines(
          this.cashInSafeTypeRoutingFailures,
        ),
      );
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
      if (this.isInbound()) {
        const moneyTypeKey = this.cashInMoneyTypeBalanceKey(
          line.SourceIds[0],
          line.VoucherType,
        );
        if (this.unbalancedCashInMoneyTypeKeys.has(moneyTypeKey)) {
          line.AddError(
            'UnbalancedInvoice',
            `UniqueId ${line.SourceIds[0]} money type ${line.VoucherType || 'unknown'} is unbalanced after FX`,
          );
        }
      } else if (this.unbalancedUniqueIds.has(line.SourceIds[0])) {
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

      this.validateBankLikeAccountDisplayValues(line);

      // Cash-In no longer fails validation when a FreeTextInvoice is missing
      // or unposted in FO. MarkedInvoice / MarkedLines are still formatted and
      // attached when present; FO remains the source of settlement truth.

      if (!this.isInbound()) {
        let shouldValidateCashOutMarkedInvoice = true;
        try {
          const route = this.cashJournalRoutingService.resolve({
            safeType: line.SafeType,
            targetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
            voucherType: line.VoucherType,
          });
          // Invoice existence checks only apply when MarkedLines target a
          // vendor invoice (not custody document/operation marking).
          shouldValidateCashOutMarkedInvoice =
            (route.safeType === 'Vendor Payment' ||
              route.safeType === 'Custody Settlement') &&
            line.SettlementTargetType === 'VendorInvoice';
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

  protected mapToModel(data: EntryRawDataModel[]): CashEntryRawDataModel[] {
    const kind = this.isTrucking() ? 'Fleet' : 'Freight';
    return data.map(
      (d) => new CashEntryRawDataModel(d, kind, this.isInbound()),
    );
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
        this.isWithholdingLedgerLine(line) ||
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

      // Ledger-only UniqueIds are main-account-only Cash Out lines (no vendor
      // debit, no payment offset). The custom API posts each Ledger row as a
      // single-sided journal line with offset fields omitted.
      if (this.isMainAccountOnlyLedgerGroup(group)) {
        continue;
      }

      const vendors = group.filter(
        (line) => line.IsVendor && Number(line.DEBITAMOUNT) > 0,
      );
      // Credit Bank/Cash/Ledger payment rows. Withholding (223304) is not an
      // offset — it rides on the vendor MarkedLines. Zero offsets means the
      // Cash Out API will create main-account-only (single-sided) vendor lines.
      const paymentOffsets = group.filter(
        (line) =>
          Number(line.CREDITAMOUNT) > 0 && !this.isWithholdingLedgerLine(line),
      );
      const invalidDebitLines = group.filter(
        (line) => Number(line.DEBITAMOUNT) > 0 && !line.IsVendor,
      );
      const hasValidOffsetShape =
        vendors.length > 0 &&
        (paymentOffsets.length === 0 || paymentOffsets.length === 1) &&
        invalidDebitLines.length === 0;
      if (!hasValidOffsetShape) {
        const accountTypes = [
          ...new Set(
            group.map(
              (line) => String(line.ACCOUNTTYPE ?? '').trim() || '(blank)',
            ),
          ),
        ].join(', ');
        errors.push(
          `UniqueId ${sourceId}: Vendor Payment requires (a) one or more debit Vendor lines with either one credit payment offset or none, or (b) Ledger-only main-account-only lines with no offset account. Found ${vendors.length} Vendor line(s), ${paymentOffsets.length} payment offset(s), and ${invalidDebitLines.length} non-Vendor debit line(s). Account types in group: ${accountTypes}.`,
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
      getAccountDisplayValue: () => string,
      getDefaultDimensionDisplayValue: () => string,
      setDimensionDisplayValue: (trimmed: string) => void,
      finTagDisplayValue: string,
    ) => {
      let dimensionString =
        accountType === 'Ledger'
          ? getAccountDisplayValue()
          : getDefaultDimensionDisplayValue();
      if (!dimensionString?.trim()) return;

      const lineContext = `Line ${line.LINENUMBER || '?'} (UniqueId ${line.UniqueId || '?'}) ${label}`;
      const paddedSegments =
        this.utilsService.findPaddedDimensionSegments(dimensionString);
      // Excel often pads dimension segments with trailing spaces. Aborting the
      // whole batch left Total Formatted at 0 for thousands of good rows, so
      // normalize in-place and keep formatting the rest of the file.
      if (paddedSegments.length > 0) {
        dimensionString =
          this.utilsService.trimDimensionDisplaySegments(dimensionString);
        setDimensionDisplayValue(dimensionString);
        this.logger.warn(
          `${lineContext}: trimmed leading/trailing spaces from dimension segment(s) ${paddedSegments
            .map((segment) => `"${segment.raw}"`)
            .join(', ')}`,
        );
      }

      const dimensions =
        this.utilsService.parseDimensionString(dimensionString);
      const sourceSegments = dimensionString.split('|');
      if (!String(sourceSegments[12] ?? '').trim()) {
        dimensions.freightType = undefined;
      }
      const validationLine = new CashEntryDynDataModel(dimensions, {
        SourceIds: [String(line.UniqueId)],
        AccountType: accountType as any,
        AccountDisplayValue: getAccountDisplayValue(),
        FinTagDisplayValue: finTagDisplayValue,
      });
      this.validateDimensionsForLine(validationLine);
      for (const error of validationLine.GetErrors()) {
        errors.push(`${lineContext}: ${error}`);
      }
    };

    validateSide(
      'account',
      line.ACCOUNTTYPE,
      () => line.ACCOUNTDISPLAYVALUE,
      () => line.DEFAULTDIMENSIONDISPLAYVALUE,
      (trimmed) => {
        if (line.ACCOUNTTYPE === 'Ledger') {
          line.ACCOUNTDISPLAYVALUE = trimmed;
        } else {
          line.DEFAULTDIMENSIONDISPLAYVALUE = trimmed;
        }
      },
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
        () => line.OFFSETACCOUNTDISPLAYVALUE,
        () => line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
        (trimmed) => {
          if (line.OFFSETACCOUNTTYPE === 'Ledger') {
            line.OFFSETACCOUNTDISPLAYVALUE = trimmed;
          } else {
            line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = trimmed;
          }
        },
        line.OFFSETFINTAGDISPLAYVALUE,
      );
    }
  }

  private async collectSettlementTargetErrors(
    lines: CashEntryRawDataModel[],
    errors: string[],
  ): Promise<void> {
    // VendorGroup drives MarkedLines (custody vs trade) for every cash-out
    // vendor line — Custody Settlement / Direct / Other included, not only
    // Vendor Payment. Settlement-target FO lookups below stay Vendor Payment.
    const allVendorLines = lines.filter((line) => line.IsVendor);
    if (allVendorLines.length === 0) return;

    const vendorAccounts = [
      ...new Set(
        allVendorLines
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
    for (const line of allVendorLines) {
      line.VendorGroup = getVendorGroup(line);
      if (isCustodyVendor(line)) {
        line.IsCustodyVendor = true;
      }
    }
    for (const vendorAccount of vendorAccounts) {
      if (!vendorGroupByAccount.get(vendorAccount.toLowerCase())) {
        errors.push(
          `Vendor ${vendorAccount}: vendor group could not be determined from D365FO. Sync vendor master data and retry.`,
        );
      }
    }

    const vendorLines = allVendorLines.filter((line) => line.IsVendorPayment);
    if (vendorLines.length === 0) return;

    const normalVendorLines = vendorLines.filter(
      (line) => !isCustodyVendor(line),
    );
    const custodyVendorLines = vendorLines.filter(isCustodyVendor);

    const invoices = normalVendorLines
      .map((line) =>
        this.sanitizeInvoiceOutbound(
          line.MARKEDINVOICE || line.INVOICE || line.DOCUMENT,
        ),
      )
      .filter(Boolean);
    const existingPairs =
      await this.vendorInvoiceJournalService.findExistingInvoiceVendorPairs(
        this.company,
        invoices,
        {
          vendorAccounts,
          pairs: normalVendorLines
            .map((line) => ({
              invoice: this.sanitizeInvoiceOutbound(
                line.MARKEDINVOICE || line.INVOICE || line.DOCUMENT,
              ),
              vendorAccount: String(line.ACCOUNTDISPLAYVALUE ?? '').trim(),
            }))
            .filter((pair) => pair.invoice && pair.vendorAccount),
        },
      );
    for (const line of normalVendorLines) {
      const invoice = this.sanitizeInvoiceOutbound(
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
        operationNumber: this.firstFinancialTag(line.FINTAGDISPLAYVALUE),
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
        line.MARKEDINVOICE = this.sanitizeInvoiceOutbound(
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
    if (this.isInbound()) {
      return this.isTrucking() ? 'Cust-Pay' : 'Cust-Pay';
    }

    const route = this.resolveCashOutJournalRoute(safeType);
    if (route) return route.journalName;
    return this.isTrucking() ? 'P-Fleet' : 'P-Freight';
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

  protected resolvePostingProfileForAccount(
    accountType: unknown,
    ...sourceProfiles: Array<string | null | undefined>
  ): string {
    const rawAccountType =
      typeof accountType === 'string' || typeof accountType === 'number'
        ? String(accountType)
        : '';
    const normalized = rawAccountType.trim().toLowerCase().replace(/\s+/g, '');
    const isVendor = normalized === 'vend' || normalized === 'vendor';
    const isCustomer = normalized === 'cust' || normalized === 'customer';

    // RCash/Petty cash, Bank, and Ledger accounts are posted directly and do
    // not use AP/AR posting profiles. A vendor profile on those primary lines
    // causes FO to search for the cash account inside V-PP.
    if (!isVendor && !isCustomer) return '';

    const fromSource = sourceProfiles
      .map((profile) => String(profile ?? '').trim())
      .find(Boolean);
    if (fromSource) return fromSource;
    return isCustomer ? 'Cust-PP' : 'V-PP';
  }

  protected getCollectionDescriptionLabel(): string {
    return this.isTrucking() ? 'Fleet' : 'Freight';
  }

  protected filterLines(sortedLines: CashEntryRawDataModel[]): {
    custodySettlementLines: CashEntryRawDataModel[];
    otherLines: CashEntryRawDataModel[];
    vendorPayment: CashEntryRawDataModel[];
  } {
    // Cash-out: keep every SafeType on the cash-out path (no custody/vendor split).
    if (!this.isInbound()) {
      return {
        custodySettlementLines: [],
        otherLines: sortedLines,
        vendorPayment: [],
      };
    }

    const custodySettlementLines: CashEntryRawDataModel[] = [];
    const vendorPayment: CashEntryRawDataModel[] = [];
    const otherLines: CashEntryRawDataModel[] = [];

    for (const line of sortedLines) {
      if (line.IsCustodySettlement) {
        custodySettlementLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    return {
      custodySettlementLines,
      otherLines,
      vendorPayment,
    };
  }

  /**
   * Route Custody Settlement UniqueIds from a Cash-In upload to Cash-Out
   * before any Cash-In customer FX / 421103 / invoice rules run.
   */
  protected async routeCashInCustodySettlementToCashOut(
    lines: CashEntryRawDataModel[],
  ): Promise<CashEntryRawDataModel[]> {
    this.cashInSafeTypeRoutingFailures = [];

    if (!this.isInbound() || lines.length === 0) {
      return lines;
    }

    const split = this.cashInSafeTypeRoutingService.splitCashInGroups(lines, {
      defaultTargetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
    });

    this.cashInSafeTypeRoutingFailures = split.failures;

    for (const failure of split.failures) {
      this.logger.warn(
        `Transaction processor could not be resolved. ${JSON.stringify({
          uniqueId: failure.uniqueId,
          voucher: failure.voucher,
          lineNumbers: failure.lineNumbers,
          safeTypes: failure.safeTypes,
          targetProcessors: failure.targetProcessors,
          reason: failure.message,
        })}`,
      );
    }

    await this.dispatchCashOutCustodySettlementBatches({
      freightLines: split.cashOutFreightLines,
      fleetLines: split.cashOutFleetLines,
    });

    return split.cashInLines;
  }

  protected async processCustodySettlementLines(
    lines: CashEntryRawDataModel[],
  ): Promise<void> {
    if (lines.length === 0) return;

    const split = this.cashInSafeTypeRoutingService.splitCashInGroups(lines, {
      defaultTargetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
    });

    await this.dispatchCashOutCustodySettlementBatches({
      freightLines: split.cashOutFreightLines,
      fleetLines: split.cashOutFleetLines,
    });
  }

  private async dispatchCashOutCustodySettlementBatches(options: {
    freightLines: CashEntryRawDataModel[];
    fleetLines: CashEntryRawDataModel[];
  }): Promise<void> {
    const { freightLines, fleetLines } = options;

    if (freightLines.length > 0) {
      try {
        await this.commandBus.execute(
          new ProcessCashOutFreightCommand(
            undefined,
            this.company,
            freightLines,
          ),
        );
        this.logger.debug(
          `[STEP 2.5] Routed ${freightLines.length} custody settlement lines to Cash-Out Freight`,
        );
      } catch (error) {
        this.logger.error(
          `[STEP 2.5] Error routing custody settlement lines to Cash-Out Freight: ${error}`,
        );
        throw error;
      }
    }

    if (fleetLines.length > 0) {
      try {
        await this.commandBus.execute(
          new ProcessCashOutTruckingCommand(
            undefined,
            this.company,
            fleetLines,
          ),
        );
        this.logger.debug(
          `[STEP 2.5] Routed ${fleetLines.length} custody settlement lines to Cash-Out Fleet`,
        );
      } catch (error) {
        this.logger.error(
          `[STEP 2.5] Error routing custody settlement lines to Cash-Out Fleet: ${error}`,
        );
        throw error;
      }
    }
  }

  protected buildCashInSafeTypeRoutingFailureLines(
    failures: CashInSafeTypeRoutingFailure[],
  ): CashEntryDynDataModel[] {
    return failures.map((failure) => {
      const line = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [failure.uniqueId],
        SafeType: (failure.safeTypes[0] ||
          'Custody Settlement') as CashEntryRawDataModel['SafeType'],
        VoucherType: failure.lines[0]?.VoucherType,
      });
      line.AddError(
        'SafeTypeRouting',
        `${failure.message} ${JSON.stringify({
          uniqueId: failure.uniqueId,
          voucher: failure.voucher,
          lineNumbers: failure.lineNumbers,
          safeTypes: failure.safeTypes,
          targetProcessors: failure.targetProcessors,
        })}`,
      );
      return line;
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
   * Cash-Out: balance each UniqueId with the official D365 FX snapshot.
   * Cash-In: balance each UniqueId + money type (VoucherType) subgroup so a
   * Cash entry is never mixed with Cheque/Transfer of the same UniqueId.
   */
  protected checkInvoiceBalancedAfterFx(
    invoiceMap: Map<string, EntryRawDataModel[]>,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): Set<string> {
    if (this.isInbound()) {
      return this.checkCashInBalancedByUniqueIdAndMoneyType(
        invoiceMap,
        exchangeRateContext,
      );
    }

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

  /**
   * Cash-In balance unit: same UniqueId AND same money type (VoucherType).
   * Example: UniqueId 100 Cash must balance on its own; UniqueId 100 Transfer
   * is a separate group and is never netted against the Cash lines.
   */
  private checkCashInBalancedByUniqueIdAndMoneyType(
    invoiceMap: Map<string, EntryRawDataModel[]>,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): Set<string> {
    this.unbalancedUniqueIds.clear();
    this.unbalancedCashInMoneyTypeKeys.clear();

    for (const [uniqueId, lines] of invoiceMap) {
      // Successful customer-FX transforms intentionally leave residual debit
      // lines after skipping 421103. Do not treat that residual as unbalanced.
      const fxResult = this.cashInCustomerFxResults.get(uniqueId);
      if (
        fxResult &&
        !fxResult.isInvalid &&
        (fxResult.matchedPairs.length > 0 ||
          fxResult.skippedLedgerLineIds.size > 0)
      ) {
        continue;
      }

      const byMoneyType = new Map<string, EntryRawDataModel[]>();
      for (const line of lines) {
        const moneyType = this.normalizeCashInMoneyType(line.VoucherType);
        const group = byMoneyType.get(moneyType);
        if (group) group.push(line);
        else byMoneyType.set(moneyType, [line]);
      }

      for (const [moneyType, groupLines] of byMoneyType) {
        const balanced = exchangeRateContext
          ? this.isCashGroupBalancedWithOfficialFx(
              groupLines,
              exchangeRateContext,
            )
          : this.isCashGroupBalancedWithExcelFx(groupLines);
        if (balanced === false) {
          this.unbalancedUniqueIds.add(uniqueId);
          this.unbalancedCashInMoneyTypeKeys.add(
            this.cashInMoneyTypeBalanceKey(uniqueId, moneyType),
          );
        }
      }
    }

    return this.unbalancedUniqueIds;
  }

  private normalizeCashInMoneyType(voucherType: unknown): string {
    const normalized = String(voucherType ?? '')
      .trim()
      .toLowerCase();
    return normalized || 'unknown';
  }

  private cashInMoneyTypeBalanceKey(
    uniqueId: unknown,
    voucherType: unknown,
  ): string {
    return `${String(uniqueId ?? '').trim()}|${this.normalizeCashInMoneyType(voucherType)}`;
  }

  /** `false` = unbalanced, `true` = balanced, `null` = skip (missing FX). */
  private isCashGroupBalancedWithOfficialFx(
    lines: EntryRawDataModel[],
    exchangeRateContext: CashOutExchangeRateContext,
  ): boolean | null {
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      const resolution = this.resolveCashOutExchangeRate(
        exchangeRateContext,
        line.TRANSDATE,
        line.CURRENCYCODE,
      );
      if (resolution.kind === 'missing') {
        return null;
      }
      const fxRate =
        resolution.kind === 'not-required' ? 1 : resolution.rate / 100;
      totalDebit += Number(line.DEBITAMOUNT || 0) * fxRate;
      totalCredit += Number(line.CREDITAMOUNT || 0) * fxRate;
    }

    return Math.abs(totalDebit - totalCredit) <= 0.01;
  }

  private isCashGroupBalancedWithExcelFx(lines: EntryRawDataModel[]): boolean {
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      const currencyCode = String(line.CURRENCYCODE ?? '')
        .trim()
        .toUpperCase();
      let fxRate = 1;

      if (currencyCode && currencyCode !== 'EGP') {
        let rate = Number(line.EXCHANGERATE) || 0;
        if (rate >= 1000) rate = rate / 100;
        else if (rate > 0 && rate < 0.1) rate = rate * 100;
        fxRate = rate || 1;
      }

      totalDebit += Number(line.DEBITAMOUNT || 0) * fxRate;
      totalCredit += Number(line.CREDITAMOUNT || 0) * fxRate;
    }

    return Math.abs(totalDebit - totalCredit) <= 0.01;
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
      if (lines[0]?.IsVendorPayment) {
        return this.buildVendorPaymentLines(
          sourceId,
          lines,
          exchangeRateContext,
        );
      }

      const custodySettlementSplit = this.buildCustodySettlementCashOutLines(
        sourceId,
        lines,
        exchangeRateContext,
      );
      if (custodySettlementSplit) {
        return custodySettlementSplit;
      }

      // Every non-Vendor-Payment SafeType keeps the original debit/credit
      // rows. Only Vendor Payment converts a source counterpart into Offset.
      // 223304 must still become Vendor→Ledger companions: posting Ledger
      // 223304 as a main account on an AP payment journal makes FO call
      // TaxWithhold::construct(Ledger) and fail.
      const withholdingLines = lines.filter((line) =>
        this.isWithholdingLedgerLine(line),
      );
      const preservedLines = lines.filter(
        (line) => !this.isWithholdingLedgerLine(line),
      );
      const built = preservedLines.map((line) =>
        this.buildSourceLineOutbound(
          sourceId,
          line,
          exchangeRateContext,
          line.IsVendor
            ? this.findWithholdingLine(line, withholdingLines)
            : undefined,
          lines,
        ),
      );
      built.push(
        ...this.buildCashOutWithholdingCompanions(
          sourceId,
          lines,
          withholdingLines,
          exchangeRateContext,
        ),
      );
      return built;
    }

    const specialCase = this.cashInCustomerFxResults.get(sourceId);
    if (specialCase?.isInvalid) {
      return this.buildCashInCustomerFxLines(
        sourceId,
        lines,
        specialCase,
        exchangeRateContext,
      );
    }

    // Cash-In is source-line preserving: every surviving Excel row becomes
    // one D365 journal line with empty offsets. A sibling row must never be
    // consumed as Offset. Customer invoice settlement stays on the customer
    // row via MarkedLines.
    return lines.map((line) =>
      this.buildSourceLineInbound(sourceId, line, lines, exchangeRateContext),
    );
  }

  /**
   * Split mixed Custody Settlement groups into:
   * - vendor-payment-style lines for standard vendor invoice settlement rows
   * - preserved one-to-one lines for true custody/counterpart ledger rows
   *
   * This matches Finance's VendPaym expectations more closely: the shared cash
   * row should become the offset for the standard vendor payment lines instead
   * of staying as a separate main line inside the same batch.
   */
  private buildCustodySettlementCashOutLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] | null {
    if (lines.length === 0) return null;

    const safeTypes = new Set(lines.map((line) => line.SafeType));
    if (safeTypes.size !== 1 || lines[0]?.SafeType !== 'Custody Settlement') {
      return null;
    }

    const paymentOffsetLines = lines.filter((line) =>
      this.isCashOutSettlementOffsetSource(line),
    );
    if (paymentOffsetLines.length !== 1) {
      return null;
    }

    const paymentOffsetLine = paymentOffsetLines[0];
    const allWithholdingLines = lines.filter((line) =>
      this.isWithholdingLedgerLine(line),
    );
    const invoiceSettlementVendorLines = lines.filter(
      (line) =>
        this.isStandardVendorInvoiceSettlementLine(line) &&
        Number(line.DEBITAMOUNT) > 0,
    );

    if (invoiceSettlementVendorLines.length === 0) {
      return null;
    }

    const relatedWithholdingLines = allWithholdingLines.filter((withholdingLine) =>
      invoiceSettlementVendorLines.some((vendorLine) =>
        this.isWithholdingLinkedToVendor(vendorLine, withholdingLine),
      ),
    );

    const vendorPaymentSubset = [
      ...invoiceSettlementVendorLines,
      paymentOffsetLine,
      ...relatedWithholdingLines,
    ];
    const subsetBalanceError = this.validateVendorPaymentWithholdingBalance(
      sourceId,
      invoiceSettlementVendorLines,
      paymentOffsetLine,
      relatedWithholdingLines,
    );
    if (subsetBalanceError) {
      // A cash row can be the counterpart of the entire custody voucher rather
      // than of only the trade-vendor invoice rows. Consuming it here would
      // make every vendor row self-balanced while leaving the other custody
      // rows unbalanced (and would also drop the shared cash source row).
      this.logger.debug(
        `Custody Settlement UniqueId=${sourceId}: preserving source lines because the vendor-payment subset is not independently balanced. ${subsetBalanceError}`,
      );
      return null;
    }
    const vendorPaymentBuilt = this.buildVendorPaymentLines(
      sourceId,
      vendorPaymentSubset,
      exchangeRateContext,
    );

    const consumedLines = new Set<CashEntryRawDataModel>(vendorPaymentSubset);
    const remainingWithholdingLines = allWithholdingLines.filter(
      (line) => !consumedLines.has(line),
    );
    const preservedLines = lines.filter(
      (line) =>
        !consumedLines.has(line) && !this.isWithholdingLedgerLine(line),
    );
    const preservedBuilt = preservedLines.map((line) =>
      this.buildSourceLineOutbound(
        sourceId,
        line,
        exchangeRateContext,
        line.IsVendor
          ? this.findWithholdingLine(line, remainingWithholdingLines)
          : undefined,
        lines,
      ),
    );
    preservedBuilt.push(
      ...this.buildCashOutWithholdingCompanions(
        sourceId,
        preservedLines,
        remainingWithholdingLines,
        exchangeRateContext,
      ),
    );

    return [...preservedBuilt, ...vendorPaymentBuilt];
  }

  private isCashOutSettlementOffsetSource(
    line: CashEntryRawDataModel,
  ): boolean {
    const accountType = String(line.ACCOUNTTYPE ?? '').trim().toLowerCase();
    return (
      Number(line.CREDITAMOUNT) > 0 &&
      !line.IsVendor &&
      ['bank', 'petty cash', 'cash', 'rcash'].includes(accountType)
    );
  }

  private isStandardVendorInvoiceSettlementLine(
    line: CashEntryRawDataModel,
  ): boolean {
    if (!line.IsVendor) return false;

    const vendorGroup = String(line.VendorGroup ?? '').trim().toLowerCase();
    const invoice = this.sanitizeInvoiceOutbound(
      line.MARKEDINVOICE || line.INVOICE,
    );

    return !line.IsCustodyVendor && vendorGroup !== 'custody' && Boolean(invoice);
  }

  private isWithholdingLinkedToVendor(
    vendorLine: CashEntryRawDataModel,
    withholdingLine: CashEntryRawDataModel,
  ): boolean {
    return (
      this.findWithholdingLine(vendorLine, [withholdingLine]) ===
        withholdingLine ||
      (Boolean(this.sanitizeInvoiceOutbound(withholdingLine.INVOICE)) &&
        this.sanitizeInvoiceOutbound(vendorLine.INVOICE) ===
          this.sanitizeInvoiceOutbound(withholdingLine.INVOICE))
    );
  }

  protected buildVendorPaymentLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    // SafeType Vendor Payment + Ledger-only rows → single-sided main-account
    // lines (offset fields omitted later by the Cash Out mapper).
    if (this.isMainAccountOnlyLedgerGroup(lines)) {
      return lines.map((line) =>
        this.buildSourceLineOutbound(sourceId, line, exchangeRateContext),
      );
    }

    const withholdingLines = lines.filter((line) =>
      this.isWithholdingLedgerLine(line),
    );
    const vendorLines = lines.filter(
      (line) => line.IsVendor && Number(line.DEBITAMOUNT) > 0,
    );
    // Normal payment = non-Vendor, non-223304 credit (Petty Cash / Bank /
    // Ledger / Cash / …). WHT credits must never be selected as the offset.
    const offsetLines = lines.filter(
      (line) =>
        Number(line.CREDITAMOUNT) > 0 &&
        !line.IsVendor &&
        !this.isWithholdingLedgerLine(line),
    );

    if (vendorLines.length === 0 || offsetLines.length > 1) {
      const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: 'Vendor Payment',
      });
      invalid.AddError(
        'InvalidMapping',
        `Vendor Payment requires (a) one or more debit Vendor lines with either one credit payment offset or none, or (b) Ledger-only main-account-only lines. Found ${vendorLines.length} Vendor line(s) and ${offsetLines.length} payment offset(s). UniqueId=${sourceId}.`,
      );
      return [invalid];
    }

    // No payment offset and no WHT: post each vendor debit as a single-sided
    // (main-account-only) journal line.
    if (offsetLines.length === 0) {
      if (withholdingLines.length > 0) {
        return this.buildWithholdingOnlyVendorPaymentLines(
          sourceId,
          vendorLines,
          withholdingLines,
          exchangeRateContext,
        );
      }
      return vendorLines.map((vendorLine) =>
        this.buildSourceLineOutbound(
          sourceId,
          vendorLine,
          exchangeRateContext,
          this.findWithholdingLine(vendorLine, withholdingLines),
        ),
      );
    }

    const paymentOffset = offsetLines[0];
    return this.mergeVendorPaymentLinesWithOffset(
      sourceId,
      vendorLines,
      paymentOffset,
      withholdingLines,
      exchangeRateContext,
    );
  }

  /**
   * A balanced Vendor Payment group may consist entirely of vendor debit(s)
   * and 223304 withholding credit(s), with no bank/cash payment portion. Keep
   * every WHT row as a Vendor→223304 transaction and put the matching invoice
   * settlement mark on every companion.
   */
  private buildWithholdingOnlyVendorPaymentLines(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    withholdingLines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const totalVendorDebit = this.roundMoney(
      vendorLines.reduce((sum, line) => sum + Number(line.DEBITAMOUNT ?? 0), 0),
    );
    const totalWithholdingCredit = this.roundMoney(
      withholdingLines.reduce(
        (sum, line) => sum + Number(line.CREDITAMOUNT ?? line.DEBITAMOUNT ?? 0),
        0,
      ),
    );
    if (!this.areMoneyAmountsEqual(totalVendorDebit, totalWithholdingCredit)) {
      return [
        this.buildVendorPaymentValidationError(
          sourceId,
          'UnbalancedWithholding',
          `Vendor Payment UniqueId=${sourceId}: no payment offset was supplied, but vendor debit ${totalVendorDebit} does not equal withholding credit ${totalWithholdingCredit}.`,
        ),
      ];
    }

    const { assignments, error } = this.allocateWhtLinesToVendors(
      sourceId,
      vendorLines,
      withholdingLines,
    );
    if (error) {
      return [
        this.buildVendorPaymentValidationError(
          sourceId,
          'WithholdingAllocation',
          error,
        ),
      ];
    }

    return vendorLines.flatMap((vendorLine) =>
      (assignments.get(vendorLine) ?? []).map((withholdingLine) =>
        this.buildLineOutbound(
          sourceId,
          vendorLine,
          withholdingLine,
          'OFFSET',
          exchangeRateContext,
          [{ vendorLine, withholdingLine }],
        ),
      ),
    );
  }

  /**
   * Vendor Payment offset rule:
   *
   * UniqueId shape: N debit Vendor lines + exactly one non-223304 credit
   * payment offset (+ optional 223304 withholding credits)
   * → one FO journal line per vendor debit line:
   *   - Account = vendor
   *   - Offset = shared payment account (Petty Cash / Bank / Ledger / …)
   *   - DebitAmount = that vendor's DEBITAMOUNT − WHT allocated to it only
   *   - MarkedLines = vendor invoice
   * → one additional FO journal line per matched 223304 withholding row:
   *   - Account = matched vendor (exact invoice → accounting shape → line #)
   *   - Offset = withholding ledger
   *   - DebitAmount = withholding CREDITAMOUNT (preserved, once only)
   *   - MarkedLines = same vendor invoice (both portions settle the invoice)
   */
  private mergeVendorPaymentLinesWithOffset(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    paymentOffset: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const balanceError = this.validateVendorPaymentWithholdingBalance(
      sourceId,
      vendorLines,
      paymentOffset,
      withholdingLines,
    );
    if (balanceError) {
      return [
        this.buildVendorPaymentValidationError(
          sourceId,
          withholdingLines.length > 0
            ? 'UnbalancedWithholding'
            : 'UnbalancedPayment',
          balanceError,
        ),
      ];
    }

    const { assignments, error: allocationError } =
      this.allocateWhtLinesToVendors(sourceId, vendorLines, withholdingLines);
    if (allocationError) {
      return [
        this.buildVendorPaymentValidationError(
          sourceId,
          'WithholdingAllocation',
          allocationError,
        ),
      ];
    }

    const results: CashEntryDynDataModel[] = [];

    for (const vendorLine of vendorLines) {
      const matchedWithholding = assignments.get(vendorLine) ?? [];
      const vendorWhtTotal = this.roundMoney(
        matchedWithholding.reduce(
          (sum, line) =>
            sum + Number(line.CREDITAMOUNT ?? line.DEBITAMOUNT ?? 0),
          0,
        ),
      );
      const vendorDebit = this.roundMoney(Number(vendorLine.DEBITAMOUNT ?? 0));
      const normalPaymentAmount = this.roundMoney(vendorDebit - vendorWhtTotal);
      const primaryWithholding = matchedWithholding[0];
      const hasPrimaryPaymentLine =
        normalPaymentAmount > 0 || matchedWithholding.length === 0;

      // Payment offset merge: always take the vendor debit amount from the
      // ACCOUNT (vendor) row — never substitute the shared payment credit.
      // Only this vendor's allocated WHT is deducted.
      if (hasPrimaryPaymentLine) {
        results.push(
          this.buildLineOutbound(
            sourceId,
            vendorLine,
            paymentOffset,
            'ACCOUNT',
            exchangeRateContext,
            [{ vendorLine, withholdingLine: primaryWithholding }],
            vendorWhtTotal,
          ),
        );
      }

      for (const withholdingLine of matchedWithholding) {
        // Separate FO line for 223304: vendor account + withholding offset.
        // It carries the same invoice mark as the payment portion so Finance
        // can settle the withheld amount against the same vendor invoice.
        results.push(
          this.buildLineOutbound(
            sourceId,
            vendorLine,
            withholdingLine,
            'OFFSET',
            exchangeRateContext,
            [{ vendorLine, withholdingLine }],
          ),
        );
      }
    }

    const generatedError = this.validateGeneratedVendorPaymentAmounts(
      sourceId,
      vendorLines,
      paymentOffset,
      withholdingLines,
      results,
    );
    if (generatedError) {
      return [
        this.buildVendorPaymentValidationError(
          sourceId,
          'UnbalancedWithholding',
          generatedError,
        ),
      ];
    }

    return results;
  }

  private buildVendorPaymentValidationError(
    sourceId: string,
    code: string,
    message: string,
  ): CashEntryDynDataModel {
    const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
      SourceIds: [sourceId],
      SafeType: 'Vendor Payment',
    });
    invalid.AddError(code, message);
    return invalid;
  }

  /**
   * Assign each 223304 withholding credit to exactly one vendor in the group.
   *
   * Priority 1: exact invoice match ("156" ≠ "1567").
   * Priority 2: among invoice matches with remaining capacity, best shape.
   * Priority 3: identical shape → lowest LINENUMBER (deterministic).
   * Unmatched invoice / over-allocation → validation error (no silent attach).
   */
  private allocateWhtLinesToVendors(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    withholdingLines: CashEntryRawDataModel[],
  ): {
    assignments: Map<CashEntryRawDataModel, CashEntryRawDataModel[]>;
    error: string | null;
  } {
    const assignments = new Map<
      CashEntryRawDataModel,
      CashEntryRawDataModel[]
    >();
    const remainingCapacity = new Map<CashEntryRawDataModel, number>();
    for (const vendorLine of vendorLines) {
      assignments.set(vendorLine, []);
      remainingCapacity.set(
        vendorLine,
        this.roundMoney(Number(vendorLine.DEBITAMOUNT ?? 0)),
      );
    }
    if (withholdingLines.length === 0) {
      return { assignments, error: null };
    }

    const orderedWithholding = [...withholdingLines].sort(
      (a, b) => Number(a.LINENUMBER ?? 0) - Number(b.LINENUMBER ?? 0),
    );
    const consumed = new Set<CashEntryRawDataModel>();

    for (const withholdingLine of orderedWithholding) {
      if (consumed.has(withholdingLine)) {
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: withholding line ` +
            `${withholdingLine.LINENUMBER} on ` +
            `${withholdingLine.ACCOUNTDISPLAYVALUE} was consumed more than once.`,
        };
      }

      const amount = this.roundMoney(
        Number(
          withholdingLine.CREDITAMOUNT ?? withholdingLine.DEBITAMOUNT ?? 0,
        ),
      );
      const withholdingInvoice = this.sanitizeInvoiceOutbound(
        withholdingLine.INVOICE,
      );
      if (!withholdingInvoice) {
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: withholding line ` +
            `${withholdingLine.LINENUMBER} account=` +
            `${withholdingLine.ACCOUNTDISPLAYVALUE} has no invoice for matching.`,
        };
      }

      const eligible = vendorLines.filter(
        (vendorLine) =>
          this.sanitizeInvoiceOutbound(vendorLine.INVOICE) ===
          withholdingInvoice,
      );
      if (eligible.length === 0) {
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: no Vendor line matches ` +
            `withholding invoice=${withholdingInvoice} ` +
            `(voucher=${withholdingLine.VOUCHER || ''}, ` +
            `whtAccount=${withholdingLine.ACCOUNTDISPLAYVALUE}, ` +
            `whtAmount=${amount}).`,
        };
      }

      const withCapacity = eligible.filter(
        (vendorLine) =>
          (remainingCapacity.get(vendorLine) ?? 0) + 1e-9 >= amount,
      );

      if (withCapacity.length === 0) {
        const vendorSummary = eligible
          .map(
            (vendorLine) =>
              `${vendorLine.ACCOUNTDISPLAYVALUE}/line=${vendorLine.LINENUMBER}/remaining=${remainingCapacity.get(vendorLine)}`,
          )
          .join('; ');
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: allocated WHT exceeds ` +
            `Vendor amount for invoice=${withholdingInvoice}, ` +
            `whtAmount=${amount}, whtAccount=${withholdingLine.ACCOUNTDISPLAYVALUE}. ` +
            `Eligible vendors: ${vendorSummary}.`,
        };
      }

      const selected = this.selectVendorForWithholdingLine(
        withholdingLine,
        withCapacity,
      );
      if (!selected) {
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: failed to select a Vendor ` +
            `for withholding invoice=${withholdingInvoice}.`,
        };
      }

      const remaining = remainingCapacity.get(selected) ?? 0;
      if (remaining + 1e-9 < amount) {
        return {
          assignments,
          error:
            `Vendor Payment UniqueId=${sourceId}: allocated WHT exceeds ` +
            `Vendor amount. vendor=${selected.ACCOUNTDISPLAYVALUE}, ` +
            `vendorAmount=${selected.DEBITAMOUNT}, invoice=${withholdingInvoice}, ` +
            `whtAmount=${amount}, whtAccount=${withholdingLine.ACCOUNTDISPLAYVALUE}.`,
        };
      }

      remainingCapacity.set(selected, this.roundMoney(remaining - amount));
      assignments.get(selected)!.push(withholdingLine);
      consumed.add(withholdingLine);
    }

    return { assignments, error: null };
  }

  private selectVendorForWithholdingLine(
    withholdingLine: CashEntryRawDataModel,
    eligibleVendors: CashEntryRawDataModel[],
  ): CashEntryRawDataModel | undefined {
    if (eligibleVendors.length === 0) return undefined;
    if (eligibleVendors.length === 1) return eligibleVendors[0];

    return [...eligibleVendors].sort((a, b) => {
      const scoreDiff =
        this.scoreVendorWithholdingShape(b, withholdingLine) -
        this.scoreVendorWithholdingShape(a, withholdingLine);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(a.LINENUMBER ?? 0) - Number(b.LINENUMBER ?? 0);
    })[0];
  }

  /**
   * Accounting-shape score for Priority 2 withholding→vendor matching.
   * Higher score = closer exact field match.
   */
  private scoreVendorWithholdingShape(
    vendorLine: CashEntryRawDataModel,
    withholdingLine: CashEntryRawDataModel,
  ): number {
    let score = 0;
    const same = (left?: string, right?: string) =>
      this.normalizeAccountingToken(left) ===
        this.normalizeAccountingToken(right) &&
      Boolean(this.normalizeAccountingToken(left));

    if (same(vendorLine.CURRENCYCODE, withholdingLine.CURRENCYCODE)) score += 1;
    if (same(vendorLine.DOCUMENT, withholdingLine.DOCUMENT)) score += 1;
    if (same(vendorLine.DOCUMENTDATE, withholdingLine.DOCUMENTDATE)) score += 1;
    if (same(vendorLine.VOUCHER, withholdingLine.VOUCHER)) score += 1;
    if (
      same(vendorLine.ACCOUNTDISPLAYVALUE, withholdingLine.ACCOUNTDISPLAYVALUE)
    ) {
      // Same vendor account value rarely appears on the ledger WHT row; kept
      // for completeness when source data repeats it.
      score += 1;
    }

    const vendorOperation = this.firstFinancialTag(
      vendorLine.FINTAGDISPLAYVALUE,
    );
    const withholdingOperation = this.firstFinancialTag(
      withholdingLine.FINTAGDISPLAYVALUE,
    );
    if (
      vendorOperation &&
      withholdingOperation &&
      vendorOperation === withholdingOperation
    ) {
      score += 1;
    }
    if (
      same(vendorLine.FINTAGDISPLAYVALUE, withholdingLine.FINTAGDISPLAYVALUE)
    ) {
      score += 1;
    }

    const vendorDimension = this.normalizeDimensionDisplayValue(
      vendorLine.DEFAULTDIMENSIONDISPLAYVALUE,
    );
    const withholdingDimension =
      this.normalizeDimensionDisplayValue(
        withholdingLine.DEFAULTDIMENSIONDISPLAYVALUE,
      ) ||
      this.normalizeDimensionDisplayValue(
        this.ledgerAccountDimensionTail(withholdingLine.ACCOUNTDISPLAYVALUE),
      );
    if (
      vendorDimension &&
      withholdingDimension &&
      vendorDimension === withholdingDimension
    ) {
      score += 1;
    }

    return score;
  }

  private normalizeAccountingToken(value?: string): string {
    return String(value ?? '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .trim()
      .toLowerCase();
  }

  private normalizeDimensionDisplayValue(value?: string): string {
    const normalized = String(value ?? '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .trim();
    if (!normalized) return '';
    return normalized.replace(/^\|+/, '|').replace(/\|+$/, '|').toLowerCase();
  }

  /** Dimension segments after the main account on a ledger ACCOUNTDISPLAYVALUE. */
  private ledgerAccountDimensionTail(accountDisplayValue?: string): string {
    const parts = String(accountDisplayValue ?? '')
      .trim()
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) return '';
    return `|${parts.slice(1).join('|')}|`;
  }

  /**
   * Cash-Out AP journals cannot insert Ledger 223304 as the main account.
   * FO then calls TaxWithhold::construct with Ledger and fails with
   * "Function TaxWithhold::construct has been incorrectly called."
   * Emit the same Vendor→223304 companion used by Vendor Payment instead.
   */
  private buildCashOutWithholdingCompanions(
    sourceId: string,
    groupLines: CashEntryRawDataModel[],
    withholdingLines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    if (withholdingLines.length === 0) return [];

    const tradeVendorLines = groupLines.filter(
      (line) =>
        line.IsVendor &&
        !line.IsCustodyVendor &&
        String(line.VendorGroup ?? '').trim().toLowerCase() !== 'custody',
    );
    const vendorLines =
      tradeVendorLines.length > 0
        ? tradeVendorLines
        : groupLines.filter((line) => line.IsVendor);
    const companions: CashEntryDynDataModel[] = [];
    const claimed = new Set<CashEntryRawDataModel>();

    for (const withholdingLine of withholdingLines) {
      const remaining = withholdingLines.filter((line) => !claimed.has(line));
      const vendorLine =
        vendorLines.find(
          (vendor) =>
            this.findWithholdingLine(vendor, remaining) === withholdingLine,
        ) ||
        vendorLines.find(
          (vendor) =>
            Boolean(this.sanitizeInvoiceOutbound(withholdingLine.INVOICE)) &&
            this.sanitizeInvoiceOutbound(vendor.INVOICE) ===
              this.sanitizeInvoiceOutbound(withholdingLine.INVOICE),
        ) ||
        (vendorLines.length === 1 ? vendorLines[0] : undefined);

      if (!vendorLine) {
        this.logger.warn(
          `Cash-Out UniqueId=${sourceId}: withholding line ${withholdingLine.LINENUMBER} account=${withholdingLine.ACCOUNTDISPLAYVALUE} has no Vendor counterpart; skipping Ledger 223304 main-account insert to avoid TaxWithhold::construct(Ledger).`,
        );
        continue;
      }

      claimed.add(withholdingLine);
      companions.push(
        this.buildLineOutbound(
          sourceId,
          vendorLine,
          withholdingLine,
          'OFFSET',
          exchangeRateContext,
          [{ vendorLine, withholdingLine }],
        ),
      );
    }

    return companions;
  }

  private findWithholdingLine(
    vendorLine: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
  ): CashEntryRawDataModel | undefined {
    if (withholdingLines.length === 0) return undefined;

    const invoice = this.sanitizeInvoiceOutbound(vendorLine.INVOICE);
    if (invoice) {
      const invoiceMatch = withholdingLines.find(
        (line) => this.sanitizeInvoiceOutbound(line.INVOICE) === invoice,
      );
      if (invoiceMatch) return invoiceMatch;
    }

    // Prefer a withholding row that already carries the settlement invoice.
    const withholdingWithInvoice = withholdingLines.find((line) =>
      Boolean(this.sanitizeInvoiceOutbound(line.INVOICE || line.DOCUMENT)),
    );
    if (withholdingWithInvoice) return withholdingWithInvoice;

    const operation = this.firstFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
    const documentMatch = withholdingLines.find(
      (line) =>
        line.DOCUMENT === vendorLine.DOCUMENT &&
        line.CURRENCYCODE === vendorLine.CURRENCYCODE &&
        this.firstFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
    );
    if (documentMatch) return documentMatch;

    // UniqueId groups usually have one 223304 row for the payment.
    return withholdingLines.length === 1 ? withholdingLines[0] : undefined;
  }

  /**
   * Source-group balance for Vendor Payment + withholding:
   * totalVendorDebit === totalNormalPaymentCredit + totalWithholdingCredit
   */
  private validateVendorPaymentWithholdingBalance(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    paymentOffset: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
  ): string | null {
    const totalVendorDebit = this.roundMoney(
      vendorLines.reduce((sum, line) => sum + Number(line.DEBITAMOUNT ?? 0), 0),
    );
    const totalNormalPaymentCredit = this.roundMoney(
      Number(paymentOffset.CREDITAMOUNT ?? 0),
    );
    const totalWithholdingCredit = this.roundMoney(
      withholdingLines.reduce(
        (sum, line) => sum + Number(line.CREDITAMOUNT ?? 0),
        0,
      ),
    );
    const expectedPayment = this.roundMoney(
      totalVendorDebit - totalWithholdingCredit,
    );
    const difference = this.roundMoney(
      totalVendorDebit - totalNormalPaymentCredit - totalWithholdingCredit,
    );

    if (Math.abs(difference) > 0.01) {
      return (
        `Vendor Payment UniqueId=${sourceId} is unbalanced: ` +
        `vendorDebit=${totalVendorDebit}, normalPaymentCredit=${totalNormalPaymentCredit}, ` +
        `withholdingCredit=${totalWithholdingCredit} ` +
        `(expected normalPaymentCredit=${expectedPayment}, difference=${difference}).`
      );
    }

    return null;
  }

  /**
   * Generated-line balance:
   * payment portions === payment credit
   * WHT portions === WHT credit
   * payment + WHT portions === vendor debit total
   */
  private validateGeneratedVendorPaymentAmounts(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    paymentOffset: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
    generated: CashEntryDynDataModel[],
  ): string | null {
    if (withholdingLines.length === 0) return null;

    const isWhtOffset = (line: CashEntryDynDataModel) =>
      String(line.OffsetAccountDisplayValue ?? '')
        .trim()
        .split('|')[0]
        .startsWith('223304');

    const generatedPaymentTotal = this.roundMoney(
      generated
        .filter((line) => !isWhtOffset(line))
        .reduce((sum, line) => sum + Number(line.DebitAmount ?? 0), 0),
    );
    const generatedWhtTotal = this.roundMoney(
      generated
        .filter((line) => isWhtOffset(line))
        .reduce((sum, line) => sum + Number(line.DebitAmount ?? 0), 0),
    );
    const totalVendorDebit = this.roundMoney(
      vendorLines.reduce((sum, line) => sum + Number(line.DEBITAMOUNT ?? 0), 0),
    );
    const totalNormalPaymentCredit = this.roundMoney(
      Number(paymentOffset.CREDITAMOUNT ?? 0),
    );
    const totalWithholdingCredit = this.roundMoney(
      withholdingLines.reduce(
        (sum, line) => sum + Number(line.CREDITAMOUNT ?? 0),
        0,
      ),
    );

    if (
      !this.areMoneyAmountsEqual(
        generatedPaymentTotal,
        totalNormalPaymentCredit,
      )
    ) {
      return (
        `Vendor Payment UniqueId=${sourceId}: generated payment portions ` +
        `${generatedPaymentTotal} do not equal payment credit ${totalNormalPaymentCredit}.`
      );
    }
    if (!this.areMoneyAmountsEqual(generatedWhtTotal, totalWithholdingCredit)) {
      return (
        `Vendor Payment UniqueId=${sourceId}: generated WHT portions ` +
        `${generatedWhtTotal} do not equal WHT credit ${totalWithholdingCredit}.`
      );
    }
    if (
      !this.areMoneyAmountsEqual(
        generatedPaymentTotal + generatedWhtTotal,
        totalVendorDebit,
      )
    ) {
      return (
        `Vendor Payment UniqueId=${sourceId}: generated vendor portions ` +
        `${this.roundMoney(generatedPaymentTotal + generatedWhtTotal)} ` +
        `do not equal vendor debit ${totalVendorDebit}.`
      );
    }

    return null;
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private areMoneyAmountsEqual(left: number, right: number): boolean {
    return this.roundMoney(left) === this.roundMoney(right);
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
        const withoutSettlementOffsetLines = this.filterOutSettlementLines(
          offsetLines,
          settlementSink,
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
        const withoutSettlementOffsetLines = this.filterOutSettlementLines(
          offsetLines,
          settlementSink,
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
    dimensions = this.filter22420LedgerDimensions(
      dimensions,
      accountLine,
      offsetLine,
    );

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

    const isNotesReceivable = this.isNotesReceivableLine(
      offsetLine,
      dimensions,
    );
    // Only force Bank offset when the bankAccount dimension segment is
    // actually populated. When empty (source data does not include a bank
    // id), fall back to the original Ledger account type so FO does not
    // reject the line with "Bank account is required".
    const hasNotesReceivableBankAccount =
      isNotesReceivable && !!dimensions.bankAccount?.trim();

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = this.getCollectionDescriptionLabel();
    const description = `Customer Collection - ${label} ${formattedDate} (${accountLine.VoucherType})`;

    const paymentReference = isNotesReceivable
      ? offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`
      : offsetLine.DESCRIPTION || '';

    const dimensionStr = this.toCashDefaultDimensionDisplayValue(
      dimensions,
      !this.is22420LedgerDimensionLine(accountLine, offsetLine),
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

    const markedInvoice = this.formatInvoiceInbound(
      accountLine.INVOICE ||
        offsetLine.INVOICE ||
        accountLine.DOCUMENT ||
        offsetLine.DOCUMENT,
    );
    const markedLines = markedInvoice
      ? [
          {
            InvoiceNumber: markedInvoice,
            OperationNumber: '',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ]
      : [];

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: hasNotesReceivableBankAccount
        ? 'Bank'
        : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: this.getPaymentMethodName(accountLine, offsetLine),
      PaymentReference: paymentReference,
      JournalName: this.getJournalName(),
      TransactionDate: accountLine.TRANSDATE,
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: this.resolveOffsetAccountDisplayValue(
        offsetLine,
        dimensions,
        hasNotesReceivableBankAccount,
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
      // D365 must always receive an empty item withholding tax group. The
      // uploaded value is still available on the raw line for validation and
      // withholding decisions, but is never sent in the outbound payload.
      ItemWithholdingTaxGroupCode: '',
      OffsetCompany: this.company,
      PostingProfile: this.resolvePostingProfileForAccount(
        accountLine.ACCOUNTTYPE,
        accountLine.POSTINGPROFILE,
        offsetLine.POSTINGPROFILE,
      ),
      Invoice: markedInvoice,
      MarkedInvoice: markedInvoice,
      MarkedLines: markedLines,
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

  /**
   * Cash-In one-to-one mapping. Each original source row is a primary journal
   * line and all offset fields remain empty. This deliberately differs from
   * the legacy inbound account/offset pairing implemented by buildLineInbound.
   */
  protected buildSourceLineInbound(
    sourceId: string,
    sourceLine: CashEntryRawDataModel,
    groupLines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel {
    const dimensionString =
      sourceLine.ACCOUNTTYPE === 'Ledger'
        ? sourceLine.ACCOUNTDISPLAYVALUE
        : sourceLine.DEFAULTDIMENSIONDISPLAYVALUE;
    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    let dimensions = this.utilsService.parseDimensionString(dimensionString);
    const is22420LedgerLine = this.is22420LedgerDimensionLine(
      sourceLine,
      undefined,
    );
    dimensions = this.filter22420LedgerDimensions(
      dimensions,
      sourceLine,
      undefined,
    );

    if (dimensions.mainAccount === '123510') {
      dimensions.mainAccount = '122204';
    }

    const transactionDate = sourceLine.TRANSDATE;
    const currencyCode = sourceLine.CURRENCYCODE;
    const officialReportingResolution = exchangeRateContext
      ? this.cashOutExchangeRateService.resolveReporting(
          exchangeRateContext,
          transactionDate,
          currencyCode,
        )
      : undefined;
    const legacyRates = this.fetchExchangeRates(transactionDate, currencyCode);
    const reportingRate = officialReportingResolution
      ? officialReportingResolution.rate
      : legacyRates.reportingRate;

    const customerInvoiceSource = sourceLine.IsCustomer
      ? sourceLine.INVOICE ||
        sourceLine.DOCUMENT ||
        groupLines.find(
          (line) => line.IsCustomer && (line.INVOICE || line.DOCUMENT),
        )?.INVOICE ||
        groupLines.find((line) => line.INVOICE || line.DOCUMENT)?.INVOICE ||
        groupLines.find((line) => line.DOCUMENT)?.DOCUMENT
      : '';
    const markedInvoice = this.formatInvoiceInbound(customerInvoiceSource);
    const markedLines = markedInvoice
      ? [
          {
            InvoiceNumber: markedInvoice,
            OperationNumber: '',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ]
      : [];

    const label = this.getCollectionDescriptionLabel();
    const defaultDescription = `Customer Collection - ${label} ${this.utilsService.formatMonthYear(sourceLine.TRANSDATE)}${sourceLine.VoucherType ? ` (${sourceLine.VoucherType})` : ''}`;
    const description = sourceLine.DESCRIPTION || defaultDescription;
    const transactionText = sourceLine.TEXT || description;
    const dimensionDisplayValue = this.toCashDefaultDimensionDisplayValue(
      dimensions,
      !is22420LedgerLine,
    );

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: transactionText,
      Company: this.company,
      AccountType: sourceLine.ACCOUNTTYPE,
      OffsetAccountType: '' as any,
      PaymentMethodName: this.sanitizePaymentMethod(sourceLine.PAYMENTMETHOD),
      PaymentReference:
        sourceLine.PAYMENTREFERENCE || sourceLine.DESCRIPTION || '',
      OffsetTransactionText: '',
      JournalName: this.getJournalName(sourceLine.SafeType),
      TransDate: transactionDate,
      TransactionDate: transactionDate,
      AccountDisplayValue: this.resolveAccountDisplayValueForOutbound(
        sourceLine.ACCOUNTTYPE,
        sourceLine.ACCOUNTDISPLAYVALUE,
      ),
      OffsetAccountDisplayValue: '',
      FinTagDisplayValue: sourceLine.FINTAGDISPLAYVALUE,
      OffsetFinTagDisplayValue: '',
      CreditAmount: sourceLine.CREDITAMOUNT,
      DebitAmount: sourceLine.DEBITAMOUNT,
      CurrencyCode: currencyCode,
      ExchRate: legacyRates.exchangeRate,
      ExchangeRate: legacyRates.exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      CustomerName: sourceLine.IsCustomer
        ? this.getCustomerName(sourceLine.ACCOUNTDISPLAYVALUE)
        : '',
      DefaultDimensionDisplayValue: dimensionDisplayValue,
      DefaultDimensionsForAccountDisplayValue: dimensionDisplayValue,
      OffsetDefaultDimensionDisplayValue: '',
      DefaultDimensionsForOffsetAccountDisplayValue: '',
      SalesTaxGroup: sourceLine.SALESTAXGROUP,
      ItemSalesTaxGroup: sourceLine.ITEMSALESTAXGROUP,
      IsWithholdingCalculationEnabled: 'No',
      ItemWithholdingTaxGroupCode: '',
      OffsetCompany: '',
      PostingProfile: this.resolvePostingProfileForAccount(
        sourceLine.ACCOUNTTYPE,
        sourceLine.POSTINGPROFILE,
      ),
      Invoice: sourceLine.IsCustomer
        ? markedInvoice
        : String(sourceLine.INVOICE ?? ''),
      MarkedInvoice: markedInvoice,
      MarkedLines: markedLines,
      dataAreaId: this.company,
      SecondaryExchangeRate: sourceLine.EXCHANGERATESECONDARY,
      ExchRateSecond: sourceLine.EXCHANGERATESECONDARY,
      Document: sourceLine.DOCUMENT,
      DocumentDate: sourceLine.DOCUMENTDATE,
      DueDate: sourceLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: sourceLine.SafeType,
      VoucherType: sourceLine.VoucherType,
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
    withholdingReduction = 0,
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
    dimensions = this.filter22420LedgerDimensions(
      dimensions,
      accountLine,
      offsetLine,
    );
    dimensions = this.omitFleetWorkerDimension(dimensions);

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

    const isNotesReceivable = this.isNotesReceivableLine(
      offsetLine,
      dimensions,
    );
    const hasNotesReceivableBankAccount =
      isNotesReceivable && !!dimensions.bankAccount?.trim();

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = this.getCollectionDescriptionLabel();
    const route = this.resolveCashOutJournalRoute(accountLine.SafeType);

    const paymentReference =
      offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`;

    const dimensionStr = this.toCashDefaultDimensionDisplayValue(
      dimensions,
      !this.is22420LedgerDimensionLine(accountLine, offsetLine),
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

    // `settlements === undefined` → default single mark from accountLine.
    // `settlements === []` → intentional no settlement marks.
    // Vendor Payment WHT companions carry their invoice marks explicitly.
    // An empty array is reserved for lines that intentionally do not settle.
    const suppressSettlement =
      Array.isArray(settlements) && settlements.length === 0;
    const normalizedSettlements =
      settlements === undefined ? [{ vendorLine: accountLine }] : settlements;
    const markedLines = suppressSettlement
      ? []
      : normalizedSettlements.map(({ vendorLine, withholdingLine }) =>
          this.buildMarkedLine(vendorLine, withholdingLine),
        );
    const primarySettlement = normalizedSettlements[0] ?? {
      vendorLine: accountLine,
    };
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
      !!(offsetLine as any).hasWithholdingReduction ||
      // Companion 223304 FO lines still need withholding flags even with no marks.
      suppressSettlement;

    const isCustodyVendor =
      accountLine.IsCustodyVendor ||
      String(accountLine.VendorGroup ?? '').trim().toLowerCase() === 'custody';
    const rawInvoice =
      primarySettlement.vendorLine.MARKEDINVOICE ||
      offsetLine.MARKEDINVOICE ||
      primarySettlement.vendorLine.INVOICE ||
      offsetLine.INVOICE;
    const sanitizedInvoice =
      suppressSettlement || isCustodyVendor
        ? ''
        : this.sanitizeInvoiceOutbound(rawInvoice);

    // Intentionally non-settling companion lines keep the payment description
    // without a "- unmarked" suffix.
    const descriptionSuffix =
      !suppressSettlement && !sanitizedInvoice ? ' - unmarked' : '';
    let description = `${route?.safeType ?? 'Vendor Payment'} - ${label} ${formattedDate} (${accountLine.VoucherType})${descriptionSuffix}`;

    // WHT companion (223304) lines: surface the withholding invoice and the
    // withheld amount in the description so the settlement is traceable.
    if (suppressSettlement) {
      const withholdingInvoice = this.sanitizeInvoiceOutbound(
        offsetLine.INVOICE || accountLine.INVOICE || offsetLine.DOCUMENT,
      );
      const withholdingAmount = Number(
        offsetLine.CREDITAMOUNT ?? offsetLine.DEBITAMOUNT ?? 0,
      );
      if (withholdingInvoice) {
        description = `${description} - Inv ${withholdingInvoice}`;
      }
      if (withholdingAmount) {
        description = `${description} - ${withholdingAmount.toFixed(2)}`;
      }
    }

    const isWhtOffset = this.isWithholdingLedgerLine(offsetLine);
    const salesTaxGroup = offsetLine.SALESTAXGROUP?.trim()?.toLowerCase() || '';
    const itemSalesTaxGroup =
      offsetLine.ITEMSALESTAXGROUP?.trim()?.toLowerCase() || '';
    const isTaxable =
      !isWhtOffset && salesTaxGroup === 'taxable' && !!itemSalesTaxGroup;

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: hasNotesReceivableBankAccount
        ? 'Bank'
        : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: this.getPaymentMethodName(accountLine, offsetLine),
      PaymentReference: paymentReference,
      JournalName:
        route?.journalName ?? this.getJournalName(accountLine.SafeType),
      TransDate: transactionDate,
      TransactionDate: transactionDate,
      VoucherType: accountLine.VoucherType,
      // Cash-Out: AccountNum = vendor; OffsetAccountDisplayValue = Bank/RCash account id or ledger account.
      AccountDisplayValue: this.resolveAccountDisplayValueForOutbound(
        accountLine.ACCOUNTTYPE,
        accountLine.ACCOUNTDISPLAYVALUE,
      ),
      OffsetAccountDisplayValue: this.resolveOffsetAccountDisplayValue(
        offsetLine,
        dimensions,
        hasNotesReceivableBankAccount,
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
          ? this.roundMoney(
              Math.max(
                0,
                normalizedSettlements.reduce(
                  (sum, { vendorLine }) =>
                    sum + Number(vendorLine.DEBITAMOUNT ?? 0),
                  0,
                ) - withholdingReduction,
              ),
            )
          : this.roundMoney(Number(offsetLine.CREDITAMOUNT ?? 0)),
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ExchangeRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: dimensionStr,
      OffsetDefaultDimensionDisplayValue: dimensionStr,
      SalesTaxGroup: isWhtOffset ? '' : isTaxable ? 'Taxable' : 'Non-Taxabl',
      ItemSalesTaxGroup: isWhtOffset ? '' : itemSalesTaxGroup,
      // Cash-Out posts 223304 as an explicit journal line. Never ask FO to
      // auto-calculate withholding (TaxWithhold::construct).
      IsWithholdingCalculationEnabled: 'No',
      ItemWithholdingTaxGroupCode: '',
      OffsetCompany: this.company,
      PostingProfile: this.resolvePostingProfileForAccount(
        accountLine.ACCOUNTTYPE,
        accountLine.POSTINGPROFILE,
        offsetLine.POSTINGPROFILE,
      ),
      Invoice: this.sanitizeInvoiceOutbound(rawInvoice),
      MarkedInvoice: sanitizedInvoice,
      MarkedLines: markedLines,
      VendorGroup: accountLine.VendorGroup ?? '',
      dataAreaId: this.company,
      // Excel exchange-rate fields (including secondary/reporting variants)
      // are intentionally ignored for Cash-Out.
      ExchRateSecond: 0,
      // The separate Vendor→223304 row owns the withholding document. Keep
      // that document on the WHT companion while the payment portion keeps
      // the vendor row's document.
      Document:
        amountSource === 'OFFSET' && isWithholding
          ? offsetLine.DOCUMENT || accountLine.DOCUMENT
          : accountLine.DOCUMENT || offsetLine.DOCUMENT,
      DocumentDate:
        amountSource === 'OFFSET' && isWithholding
          ? offsetLine.DOCUMENTDATE || accountLine.DOCUMENTDATE
          : accountLine.DOCUMENTDATE || offsetLine.DOCUMENTDATE,
      DueDate: accountLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: accountLine.SafeType,
      SettlementTargetType: isCustodyVendor
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
    withholdingLine?: CashEntryRawDataModel,
    groupLines?: CashEntryRawDataModel[],
  ): CashEntryDynDataModel {
    const dimensionString =
      sourceLine.ACCOUNTTYPE === 'Ledger'
        ? sourceLine.ACCOUNTDISPLAYVALUE
        : sourceLine.DEFAULTDIMENSIONDISPLAYVALUE;
    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    let dimensions = this.utilsService.parseDimensionString(dimensionString);
    const is22420LedgerLine = this.is22420LedgerDimensionLine(
      sourceLine,
      undefined,
    );
    dimensions = this.filter22420LedgerDimensions(
      dimensions,
      sourceLine,
      undefined,
    );
    dimensions = this.omitFleetWorkerDimension(dimensions);

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

    const isCustodySettlement =
      sourceLine.IsCustodySettlement ||
      route?.safeType === 'Custody Settlement';
    const offsetDimensionString =
      sourceLine.OFFSETACCOUNTTYPE === 'Ledger'
        ? sourceLine.OFFSETACCOUNTDISPLAYVALUE
        : sourceLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE;
    const offsetDimensions = this.omitFleetWorkerDimension(
      this.utilsService.parseDimensionString(offsetDimensionString),
    );
    let description = `${route?.safeType ?? sourceLine.SafeType} - ${this.getCollectionDescriptionLabel()} ${this.utilsService.formatMonthYear(sourceLine.TRANSDATE)}${sourceLine.VoucherType ? ` (${sourceLine.VoucherType})` : ''}`;
    const isVendorPayment =
      sourceLine.IsVendorPayment || route?.safeType === 'Vendor Payment';
    const supportsSettlementMarking = isVendorPayment || isCustodySettlement;
    const sourceHasWithholding =
      this.isWithholdingLedgerLine(sourceLine) ||
      String(sourceLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
        'yes' ||
      Boolean(sourceLine.ITEMWITHHOLDINGTAXGROUPCODE) ||
      Boolean(withholdingLine);
    const vendorGroup = String(sourceLine.VendorGroup ?? '').trim();
    const isCustodyVendor =
      sourceLine.IsCustodyVendor || vendorGroup.toLowerCase() === 'custody';
    const hasGroupWithholding =
      Boolean(withholdingLine) ||
      (groupLines ? this.groupHasWithholdingLine(groupLines) : false);

    // Build MarkedLines for vendor rows that support settlement marking.
    // The presence of a 223304 withholding ledger line in the group sets
    // HasWithHoldingLine = true but no longer suppresses the mark — D365
    // needs the invoice reference to settle correctly.
    const markedLine =
      supportsSettlementMarking && sourceLine.IsVendor
        ? this.buildMarkedLine(sourceLine, withholdingLine)
        : undefined;
    if (markedLine && hasGroupWithholding) {
      markedLine.HasWithHoldingLine = true;
    }
    const hasSettlementTarget = Boolean(
      markedLine &&
      (markedLine.InvoiceNumber ||
        markedLine.DocumentNumber ||
        markedLine.OperationNumber),
    );
    const effectiveMarkedLines =
      hasSettlementTarget && markedLine ? [markedLine] : [];
    if (
      supportsSettlementMarking &&
      sourceLine.IsVendor &&
      !hasSettlementTarget &&
      !description.toLowerCase().includes('unmarked')
    ) {
      description = `${description} - unmarked`;
    }
    const markedInvoice =
      supportsSettlementMarking && sourceLine.IsVendor && !isCustodyVendor
        ? this.sanitizeInvoiceOutbound(
            sourceLine.MARKEDINVOICE ||
              sourceLine.INVOICE ||
              sourceLine.DOCUMENT,
          )
        : '';

    let transactionText = sourceLine.TEXT || description;
    if (
      description.toLowerCase().includes('unmarked') &&
      !transactionText.toLowerCase().includes('unmarked')
    ) {
      transactionText = `${transactionText} - unmarked`;
    }

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: transactionText,
      Company: this.company,
      AccountType: sourceLine.ACCOUNTTYPE,
      OffsetAccountType: sourceLine.OFFSETACCOUNTTYPE,
      PaymentMethodName: this.sanitizePaymentMethod(sourceLine.PAYMENTMETHOD),
      PaymentReference: sourceLine.PAYMENTREFERENCE,
      OffsetTransactionText: sourceLine.OFFSETTEXT,
      JournalName:
        route?.journalName ?? this.getJournalName(sourceLine.SafeType),
      TransDate: transactionDate,
      TransactionDate: transactionDate,
      VoucherType: sourceLine.VoucherType,
      AccountDisplayValue: this.resolveAccountDisplayValueForOutbound(
        sourceLine.ACCOUNTTYPE,
        sourceLine.ACCOUNTDISPLAYVALUE,
      ),
      OffsetAccountDisplayValue: this.resolveAccountDisplayValueForOutbound(
        sourceLine.OFFSETACCOUNTTYPE,
        sourceLine.OFFSETACCOUNTDISPLAYVALUE,
      ),
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
      ExchangeRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: this.toCashDefaultDimensionDisplayValue(
        dimensions,
        !is22420LedgerLine,
      ),
      OffsetDefaultDimensionDisplayValue: offsetDimensionString
        ? this.toCashDefaultDimensionDisplayValue(offsetDimensions, true)
        : '',
      SalesTaxGroup: sourceLine.SALESTAXGROUP,
      ItemSalesTaxGroup: sourceLine.ITEMSALESTAXGROUP,
      // Cash-Out posts withholding as a Vendor→223304 companion, not via FO
      // TaxWithhold::construct. Keep this No on every source-preserving row.
      IsWithholdingCalculationEnabled: 'No',
      ItemWithholdingTaxGroupCode:
        sourceLine.ITEMWITHHOLDINGTAXGROUPCODE ?? '',
      OffsetCompany:
        sourceLine.OFFSETACCOUNTTYPE || sourceLine.OFFSETACCOUNTDISPLAYVALUE
          ? this.company
          : '',
      PostingProfile: this.resolvePostingProfileForAccount(
        sourceLine.ACCOUNTTYPE,
        sourceLine.POSTINGPROFILE,
      ),
      Invoice: this.sanitizeInvoiceOutbound(
        // Custody vendors settle by Document/Operation — never promote Document
        // into Invoice (that would mis-mark standard invoice settlement).
        isCustodyVendor
          ? sourceLine.INVOICE
          : sourceLine.INVOICE || sourceLine.DOCUMENT,
      ),
      MarkedInvoice: markedInvoice,
      MarkedLines: effectiveMarkedLines,
      VendorGroup: sourceLine.IsVendor ? vendorGroup : '',
      dataAreaId: this.company,
      ExchRateSecond: 0,
      Document: sourceLine.DOCUMENT,
      DocumentDate: sourceLine.DOCUMENTDATE,
      DueDate: sourceLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: route?.safeType ?? sourceLine.SafeType,
      // Settlement targets remain present when a separate 223304 withholding
      // transaction exists; HasWithHoldingLine links the two for Finance.
      SettlementTargetType:
        supportsSettlementMarking && sourceLine.IsVendor
          ? isCustodyVendor
            ? 'CustodyLedger'
            : 'VendorInvoice'
          : undefined,
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

    if (sourceHasWithholding && !isCustodySettlement && !isVendorPayment) {
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
   * Applies PBI #2039 to cash journals as well as vendor journals. A Ledger
   * source row can become either side of the combined cash line, so inspect
   * both account and offset inputs and treat tag/account as independent OR
   * triggers.
   */
  protected filter22420LedgerDimensions(
    dimensions: EntryDimensionsModel,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
  ): EntryDimensionsModel {
    return this.is22420LedgerDimensionLine(accountLine, offsetLine)
      ? this.utilsService.filterDimensionsForLedgerTag22420(dimensions)
      : dimensions;
  }

  protected is22420LedgerDimensionLine(
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
  ): boolean {
    const ledgerLine = [accountLine, offsetLine].find(
      (line) => line?.IsLedger || line?.ACCOUNTTYPE === 'Ledger',
    );
    if (!ledgerLine) return false;

    const has22420Tag = String(ledgerLine.FINTAGDISPLAYVALUE || '')
      .trim()
      .startsWith('22420');
    const has22420Account = String(ledgerLine.ACCOUNTDISPLAYVALUE || '')
      .trim()
      .startsWith('22420');

    return has22420Tag || has22420Account;
  }

  /**
   * Cash-out: replace FinTag shippingLine (index 2) vendor account code
   * (e.g. Al-000021) with vendorOrganizationName (e.g. Turkish Airlines).
   * Leaves the segment unchanged when no vendor name is found.
   */
  protected replaceFinTagShippingLineWithVendorName(
    finTagDisplayValue?: string,
  ): string {
    if (!finTagDisplayValue) return finTagDisplayValue ?? '';

    const parts = finTagDisplayValue.split('|');
    if (parts.length <= FINTAG_SHIPPING_LINE_INDEX) {
      return finTagDisplayValue;
    }

    const shippingLineCode = parts[FINTAG_SHIPPING_LINE_INDEX].replace(
      /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      '',
    ).trim();

    if (!shippingLineCode) {
      return finTagDisplayValue;
    }

    const vendorOrganizationName = this.getVendorName(shippingLineCode);
    if (!vendorOrganizationName) {
      return finTagDisplayValue;
    }

    parts[FINTAG_SHIPPING_LINE_INDEX] = vendorOrganizationName;
    return parts.join('|');
  }

  /**
   * Cash API default-dimension display value: no mainAccount, fixed segment order.
   * Override lives on cash base only (not EntryProcessorBase).
   */
  protected toCashDefaultDimensionDisplayValue(
    dimensions: EntryDimensionsModel | null | undefined,
    defaultFreightType = true,
  ): string {
    if (!dimensions) return '';

    return CASH_API_DIMENSION_FIELDS.map((fieldName) => {
      if (fieldName === 'freightType') {
        return this.dimensionPartAsString(
          dimensions.freightType || (defaultFreightType ? 'Payable' : ''),
        );
      }
      return this.dimensionPartAsString(dimensions[fieldName]);
    }).join('|');
  }

  /**
   * Fleet Cash-Out skips Worker validation, but FO still rejects unknown Worker
   * codes in ledger AccountNum / default dimensions. Clear Worker before post.
   */
  protected shouldOmitFleetWorkerDimension(): boolean {
    return !this.isInbound() && this.isTrucking();
  }

  protected omitFleetWorkerDimension(
    dimensions: EntryDimensionsModel,
  ): EntryDimensionsModel {
    if (this.shouldOmitFleetWorkerDimension()) {
      dimensions.worker = undefined;
    }
    return dimensions;
  }

  /**
   * Ledger display values: trim padded segments; for Fleet Cash-Out also drop
   * Worker so FO AccountNum does not carry unvalidated fleet Worker codes.
   * Non-ledger values (Vendor, Bank, RCash ids) are returned unchanged.
   */
  protected resolveAccountDisplayValueForOutbound(
    accountType: string | undefined,
    accountDisplayValue: string | undefined,
  ): string {
    const raw = accountDisplayValue ?? '';
    if (accountType !== 'Ledger') {
      return raw;
    }

    const trimmed = this.utilsService.trimDimensionDisplaySegments(raw);
    if (!this.shouldOmitFleetWorkerDimension()) {
      return trimmed;
    }

    const dims = this.omitFleetWorkerDimension(
      this.utilsService.parseDimensionString(trimmed),
    );
    const segmentLength =
      this.utilsService.getDimensionSegmentLength(trimmed) || 19;
    return this.utilsService.toDimensionStringWithSegments(dims, segmentLength);
  }

  /**
   * Bank / RCash (Petty cash) → FO account id from source ACCOUNTDISPLAYVALUE
   * (e.g. "PSD EG", "AAIB-EG-CA"), never the dimension string.
   * Ledger → full ledger account display value.
   * Notes-receivable forced to Bank → bankAccount dim segment only.
   * Never fall back to the ledger display value when Bank is required — that
   * makes FO look up `122201|1301|...` in BankAccountTable.
   */
  protected resolveOffsetAccountDisplayValue(
    offsetLine: CashEntryRawDataModel,
    dimensions: EntryDimensionsModel,
    isNotesReceivable: boolean,
    dimensionStrFallback: string,
  ): string {
    if (isNotesReceivable) {
      return this.dimensionPartAsString(dimensions.bankAccount);
    }

    if (offsetLine.IsBank || offsetLine.IsPettyCash) {
      return (offsetLine.ACCOUNTDISPLAYVALUE || '').trim();
    }

    const accountDisplay = (offsetLine.ACCOUNTDISPLAYVALUE || '').trim();
    if (accountDisplay) {
      return this.resolveAccountDisplayValueForOutbound(
        offsetLine.ACCOUNTTYPE,
        accountDisplay,
      );
    }

    return dimensionStrFallback;
  }

  private dimensionPartAsString(part: unknown): string {
    if (part === null || part === undefined) return '';
    if (typeof part !== 'string' && typeof part !== 'number') return '';
    return typeof part === 'string' ? part.trim() : String(part);
  }

  /**
   * Cash-In special case: UniqueId groups with debit + Cust credit + Ledger
   * 421103 get one-to-one debit→customer amount/currency copy, Ledger skip,
   * and consumed-pair metadata for the inbound build path.
   */
  protected applyCashInCustomerForeignCurrencyRules(
    lines: CashEntryRawDataModel[],
  ): CashEntryRawDataModel[] {
    this.cashInCustomerFxResults.clear();

    if (!this.isInbound() || lines.length === 0) {
      return lines;
    }

    const grouped = this.buildUniqueIdMap(lines);
    const output: CashEntryRawDataModel[] = [];

    for (const [uniqueId, groupLines] of grouped.entries()) {
      const { result, outputLines } = evaluateCashInCustomerFxGroup({
        uniqueId,
        lines: groupLines,
        resolveExchangeRate: (transactionDate, currencyCode) =>
          this.fetchExchangeRates(transactionDate, currencyCode),
      });

      // Only persist metadata for groups that actually entered the special case
      // (invalid or successfully transformed). Residual-only empty results are
      // omitted so non-special UniqueIds keep the existing build path.
      const enteredSpecialCase =
        result.isInvalid ||
        result.matchedPairs.length > 0 ||
        result.skippedLedgerLineIds.size > 0;

      if (enteredSpecialCase) {
        this.cashInCustomerFxResults.set(uniqueId, result);
        this.logCashInCustomerFxResult(result, groupLines);
      }

      output.push(...outputLines);
    }

    return output;
  }

  /**
   * Cash-In special-case path. Successful FX transforms and failures both keep
   * one journal line per uploaded Excel row (no collapse to a single error
   * stub), so formatted line count stays equal to the upload.
   */
  protected buildCashInCustomerFxLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    specialCase: CashInCustomerFxSpecialCaseResult,
    _exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const built = lines.map((line) =>
      this.buildSourceLineInbound(sourceId, line, lines, _exchangeRateContext),
    );

    if (!specialCase.isInvalid) {
      return built;
    }

    const attachError = (line: CashEntryDynDataModel) => {
      for (const validationError of specialCase.validationErrors) {
        const detailSuffix = validationError.details
          ? ` ${JSON.stringify(validationError.details)}`
          : '';
        line.AddError(
          validationError.field,
          `${validationError.message}${detailSuffix}`,
        );
      }
      if (specialCase.validationErrors.length === 0) {
        line.AddError(
          'CustomerDebitMatch',
          'Unable to determine a unique debit line for the customer Cash-In line.',
        );
      }
    };

    // Attach match failure to every source line so batch errors remain visible
    // without dropping rows or inventing an empty-dimension stub line.
    for (const line of built) {
      attachError(line);
    }

    return built;
  }

  private logCashInCustomerFxResult(
    result: CashInCustomerFxSpecialCaseResult,
    groupLines: CashEntryRawDataModel[],
  ): void {
    const voucher = groupLines[0]?.VOUCHER ?? '';

    if (result.isInvalid) {
      this.logger.warn(
        `Cash-In customer-to-debit matching failed. ${JSON.stringify({
          uniqueId: result.uniqueId,
          voucher,
          validationErrors: result.validationErrors,
        })}`,
      );
      return;
    }

    for (const pair of result.matchedPairs) {
      const audit = (pair.customerLine as any).__cashInFxTransform;
      this.logger.log(
        `Cash-In customer line transformed using a uniquely matched debit line. ${JSON.stringify(
          {
            uniqueId: result.uniqueId,
            voucher,
            customerLineNumber: pair.customerLineNumber,
            customerAccount: pair.customerLine.ACCOUNTDISPLAYVALUE,
            originalCreditAmount: audit?.originalCreditAmount,
            updatedCreditAmount:
              audit?.updatedCreditAmount ?? pair.customerLine.CREDITAMOUNT,
            originalCurrency: audit?.originalCurrency,
            updatedCurrency:
              audit?.updatedCurrency ?? pair.customerLine.CURRENCYCODE,
            sourceDebitLineNumber: pair.debitLineNumber,
            sourceDebitAmount: pair.debitLine.DEBITAMOUNT,
            parsedCustomerInvoices:
              audit?.parsedInvoices ??
              parseCashInCustomerInvoices(pair.customerLine),
          },
        )}`,
      );
    }
  }

  protected isNotesReceivableLine(
    line: CashEntryRawDataModel,
    dimensions: EntryDimensionsModel,
  ): boolean {
    const accountType = line.ACCOUNTTYPE;
    const mainAccount = dimensions.mainAccount;

    if (accountType !== 'Ledger') return false;

    if (!mainAccount) return false;

    return this.NOTES_RECEIVABLE_MAIN_ACCOUNTS.includes(mainAccount);
  }

  protected isSettlementLine(
    line: CashEntryRawDataModel,
    dimensions: EntryDimensionsModel,
  ): boolean {
    // Cash-In no longer treats Ledger 421103 as a special settlement/exclusion
    // line. Keep settlement filtering for Cash-Out only.
    if (this.isInbound()) {
      return false;
    }

    const accountType = normalizeCashInAccountType(line.ACCOUNTTYPE);
    const mainAccount =
      dimensions.mainAccount ||
      extractCashInMainAccount(line.ACCOUNTDISPLAYVALUE);

    if (accountType !== 'ledger') return false;
    if (!mainAccount) return false;

    return this.SETTLEMENT_MAIN_ACCOUNTS.some(
      (account) => mainAccount === account,
    );
  }

  protected filterOutSettlementLines(
    lines: CashEntryRawDataModel[],
    settlementSink: CashEntryRawDataModel[],
  ): CashEntryRawDataModel[] {
    const withoutSettlement: CashEntryRawDataModel[] = [];
    for (const line of lines) {
      const dimensions = this.utilsService.parseDimensionString(
        line.ACCOUNTDISPLAYVALUE,
      );
      if (this.isSettlementLine(line, dimensions)) {
        settlementSink.push(line);
      } else {
        withoutSettlement.push(line);
      }
    }

    return withoutSettlement;
  }

  /**
   * PAYMENTMETHODNAME is source-owned: use the Excel PAYMENTMETHOD value from
   * the transaction row, then the paired row, and never derive it from an
   * account type such as Petty cash/RCash.
   */
  protected getPaymentMethodName(
    accountLine: CashEntryRawDataModel,
    offsetLine: CashEntryRawDataModel,
  ): string {
    return (
      [accountLine.PAYMENTMETHOD, offsetLine.PAYMENTMETHOD]
        .map((value) => this.sanitizePaymentMethod(value))
        .find(Boolean) ?? ''
    );
  }

  protected sanitizePaymentMethod(value?: unknown): string {
    const s = String(value ?? '').trim();
    if (!s) return '';
    // Filter out date patterns that may have been mapped incorrectly from Excel
    if (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) ||
      /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s) ||
      /^\d{4}-\d{2}-\d{2}T/.test(s)
    ) {
      this.logger.warn(
        `[DATA QUALITY] Date-like value "${s}" found in PaymentMethod field, sanitizing to empty string`,
      );
      return '';
    }
    return s;
  }

  /**
   * Cash-out invoice sanitization: coerce to string and preserve the source
   * invoice text, including leading/trailing spaces. Use a trimmed comparison
   * value only to reject empty/all-zero placeholders. Does not use cash-in
   * number/text formatting.
   */
  protected sanitizeInvoiceOutbound(invoice?: string | number): string {
    const sourceValue = String(invoice ?? '').replace(
      /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,
      '',
    );
    const comparisonValue = sourceValue.trim();
    if (!comparisonValue) return '';
    if (/^0+$/.test(comparisonValue)) return '';
    return sourceValue;
  }

  protected isWithholdingLedgerLine(line: CashEntryRawDataModel): boolean {
    const accountType = String(line.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isLedger =
      accountType === 'ledger' ||
      accountType === 'led' ||
      Boolean(line.IsLedger);
    const mainAccount = String(line.ACCOUNTDISPLAYVALUE ?? '')
      .trim()
      .split('|')[0]
      .trim();

    const offsetAccountType = String(line.OFFSETACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isOffsetLedger =
      offsetAccountType === 'ledger' || offsetAccountType === 'led';
    const offsetMainAccount = String(line.OFFSETACCOUNTDISPLAYVALUE ?? '')
      .trim()
      .split('|')[0]
      .trim();

    return (
      (isLedger && mainAccount.startsWith('223304')) ||
      (isOffsetLedger && offsetMainAccount.startsWith('223304'))
    );
  }

  /**
   * Returns true when any line in the UniqueId group is a 223304 withholding
   * ledger line. When true, vendor lines in that group must not populate
   * MarkedLines so that D365 Finance does not attempt to double-mark the
   * invoice after the WHT companion already handles settlement.
   */
  private groupHasWithholdingLine(
    groupLines: CashEntryRawDataModel[],
  ): boolean {
    return groupLines.some((line) => this.isWithholdingLedgerLine(line));
  }

  /**
   * Vendor Payment UniqueId that is only Ledger rows with no offset account
   * on the source → main-account-only Cash Out API lines.
   */
  protected isMainAccountOnlyLedgerGroup(
    lines: CashEntryRawDataModel[],
  ): boolean {
    if (lines.length === 0) return false;
    return lines.every(
      (line) =>
        line.IsLedger &&
        !String(line.OFFSETACCOUNTTYPE ?? '').trim() &&
        !String(line.OFFSETACCOUNTDISPLAYVALUE ?? '').trim(),
    );
  }

  protected firstFinancialTag(value?: string): string {
    return String(value ?? '')
      .split('|')[0]
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .trim();
  }

  /**
   * One batched FO lookup for all cash-out marked invoices → in-memory Set.
   * Validation is then sync from the Set (no per-line FO calls).
   */
  protected async fetchVendorInvoiceExistsMap(
    lines: CashEntryDynDataModel[],
  ): Promise<void> {
    const vendorPaymentLines = lines.filter((line) => {
      const accountType = (line.AccountType || '').trim().toLowerCase();
      const isVendor = accountType === 'vend' || accountType === 'vendor';
      const hasInvoice = Boolean(
        (line.MarkedLines?.length ?? 0) > 0 ||
        (line.MarkedInvoice && String(line.MarkedInvoice).trim()) ||
        (line.Invoice && String(line.Invoice).trim()),
      );
      if (isVendor && hasInvoice) return true;

      try {
        const resolved = this.cashJournalRoutingService.resolve({
          safeType: line.SafeType,
          targetProcessor: this.isTrucking() ? 'Fleet' : 'Freight',
          voucherType: line.VoucherType,
        });
        return (
          resolved.safeType === 'Vendor Payment' ||
          resolved.safeType === 'Custody Settlement'
        );
      } catch {
        return false;
      }
    });
    const invoices = [
      ...new Set(
        vendorPaymentLines
          .flatMap((line) =>
            (line.MarkedLines?.length
              ? line.MarkedLines.map((markedLine) => markedLine.InvoiceNumber)
              : [line.MarkedInvoice || line.Invoice || '']
            ).map((invoice) => this.sanitizeInvoiceOutbound(invoice)),
          )
          .filter((invoice) => Boolean(invoice)),
      ),
    ];

    const vendorAccounts = [
      ...new Set(
        vendorPaymentLines
          .map((line) => String(line.AccountDisplayValue ?? '').trim())
          .filter(Boolean),
      ),
    ];

    if (invoices.length === 0 && vendorAccounts.length === 0) {
      this.vendorInvoiceExistsMap = new Set();
      this.logger.debug(
        '[LOOKUP] No cash-out marked invoices to resolve; skipping posted vendor invoice lookup',
      );
      return;
    }

    const pairs = vendorPaymentLines.flatMap((line) => {
      const vendorAccount = String(line.AccountDisplayValue ?? '').trim();
      const lineInvoices = (
        line.MarkedLines?.length
          ? line.MarkedLines.map((markedLine) => markedLine.InvoiceNumber)
          : [line.MarkedInvoice || line.Invoice || '']
      )
        .map((invoice) => this.sanitizeInvoiceOutbound(invoice))
        .filter((invoice) => Boolean(invoice));
      if (!vendorAccount) return [];
      return lineInvoices.map((invoice) => ({ invoice, vendorAccount }));
    });
    this.vendorInvoiceExistsMap =
      await this.vendorInvoiceJournalService.findExistingInvoiceVendorPairs(
        this.company,
        invoices,
        {
          pairs,
          vendorAccounts,
        },
      );
  }

  /**
   * Bank / Petty cash / RCash account ids must be BankAccountTable (or RCash)
   * ids — never a ledger dimension string like `122201|1301|013|001|`.
   * Cash-In posts without offsets; still validate AccountDisplayValue when the
   * primary account is bank-like.
   */
  protected validateBankLikeAccountDisplayValues(
    line: CashEntryDynDataModel,
  ): void {
    const checks: Array<{
      field: 'AccountDisplayValue' | 'OffsetAccountDisplayValue';
      accountType: string | undefined;
      value: string | undefined;
    }> = [
      {
        field: 'AccountDisplayValue',
        accountType: line.AccountType,
        value: line.AccountDisplayValue,
      },
      {
        field: 'OffsetAccountDisplayValue',
        accountType: line.OffsetAccountType,
        value: line.OffsetAccountDisplayValue,
      },
    ];

    for (const { field, accountType, value } of checks) {
      const type = (accountType || '').trim();
      if (type !== 'Bank' && type !== 'Petty cash' && type !== 'RCash') {
        continue;
      }

      const display = (value || '').trim();
      if (!display) {
        line.AddError(field, `${type} account is required; ${field} is empty.`);
        continue;
      }

      if (display.includes('|')) {
        line.AddError(
          field,
          `${type} account must be a bank/RCash id, not a ledger dimension value (${display}).`,
        );
      }
    }
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
      const invoice = String(invoiceValue ?? '');
      if (!invoice.trim()) continue;

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
    const isCustody =
      vendorLine.IsCustodyVendor || vendorGroup.toLowerCase() === 'custody';

    return {
      // Standard vendors mark by invoice (+ operation). Do not fall back to
      // DOCUMENT — that value belongs only on custody DocumentNumber marks.
      InvoiceNumber: isCustody
        ? ''
        : this.sanitizeInvoiceOutbound(
            vendorLine.MARKEDINVOICE ||
              vendorLine.INVOICE ||
              withholdingLine?.INVOICE,
          ),
      OperationNumber: this.firstFinancialTag(vendorLine.FINTAGDISPLAYVALUE),
      DocumentNumber: isCustody ? String(vendorLine.DOCUMENT ?? '').trim() : '',
      HasWithHoldingLine: Boolean(withholdingLine),
    };
  }

  /**
   * Normalize Cash-In invoice / document values to FO FreeTextNumber shape
   * (`000012345/OR-TR`). Source often appends a second number after a comma
   * (`8898/OR-TR,8932`) or falls back to draft document ids (`31906/DRAFT`)
   * that are not FreeTextInvoiceHeaders — those must not be looked up as-is.
   */
  protected formatInvoiceInbound(invoice?: string): string {
    const trimmedInvoice = invoice?.trim();
    if (!trimmedInvoice) return '';

    // Keep only the first invoice token; trailing ",000008932" is not part of
    // FreeTextNumber and causes exact-match FO lookups to fail.
    const primaryInvoice = trimmedInvoice.split(/[,;]/)[0]?.trim() ?? '';
    if (!primaryInvoice) return '';

    const parts = primaryInvoice.split('/');

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

    let newTextPart: string = parts[1]?.trim() ?? '';

    // Draft document refs are not posted free-text invoices — post unmarked.
    if (textLower === 'draft') {
      return '';
    }

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

    if (!suffix) {
      return '';
    }

    return `${number.toString().padStart(9, '0')}/${suffix}`;
  }

  protected formatInvoiceOutbound(invoice?: string): string {
    const trimmedInvoice = invoice?.trim();
    if (!trimmedInvoice) return '';

    const primaryInvoice = trimmedInvoice.split(/[,;]/)[0]?.trim() ?? '';
    if (!primaryInvoice) return '';

    const parts = primaryInvoice.split('/');

    const numberPart = parts[0]?.trim();
    let textPart = parts[1]?.trim()?.toLowerCase() ?? '';

    const number = parseInt(numberPart, 10);
    if (isNaN(number)) return '';

    if (!textPart || textPart === 'draft') {
      return '';
    }

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
    const voucherGroups = new Map<string, CashEntryRawDataModel[]>();
    for (const line of lines) {
      const voucher = line.VOUCHER;
      if (!voucher) continue;
      if (!voucherGroups.has(voucher)) {
        voucherGroups.set(voucher, []);
      }
      voucherGroups.get(voucher)!.push(line);
    }

    let withholdingLineCount = 0;
    let totalWithholdingAmount = 0;

    for (const groupLines of voucherGroups.values()) {
      const withholdingLines = groupLines.filter((line) =>
        this.isWithholdingLedgerLine(line),
      );

      for (const wLine of withholdingLines) {
        withholdingLineCount++;
        totalWithholdingAmount += wLine.CREDITAMOUNT || wLine.DEBITAMOUNT;
      }
    }

    if (withholdingLineCount > 0) {
      this.logger.debug(
        `[WITHHOLDING] Found ${withholdingLineCount} source lines on 223304 (total amount: ${totalWithholdingAmount}); treatment depends on SafeType.`,
      );
      return {
        lines,
        stats: {
          withholdingRemovedCount: withholdingLineCount,
          withholdingRemovedAmount: totalWithholdingAmount,
        },
      };
    }

    return {
      lines,
      stats: { withholdingRemovedCount: 0, withholdingRemovedAmount: 0 },
    };
  }
}
