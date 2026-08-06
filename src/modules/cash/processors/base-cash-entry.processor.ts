import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  CashInCustomerFxSpecialCaseResult,
  cashInLineStableId,
  evaluateCashInCustomerFxGroup,
  extractCashInMainAccount,
  isCashInLedger421103Line,
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
   * VendInvoiceJournalLines (filled once per enrich via batched FO lookup).
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
        await this.applyCashInCustomerForeignCurrencyRules(processedLines);
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
        `[STEP 6] Batch-looking up vendor invoices on VendInvoiceJournalLines for ${updatedDfoLines.length} lines`,
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

      this.validateBankLikeAccountDisplayValues(line);

      if (this.isInbound() && this.freeTextInvoiceMap) {
        const invoiceKey = (line.MarkedInvoice || line.Invoice || '')
          .trim()
          .toLowerCase();

        // Empty MarkedInvoice = unmarked customer collection (allowed).
        // formatInvoiceInbound clears DRAFT / non-FTI document fallbacks and
        // strips comma-glued secondary numbers before lookup.
        if (invoiceKey) {
          const entries = this.freeTextInvoiceMap.get(invoiceKey);

          const displayInvoice = line.MarkedInvoice || line.Invoice;

          if (!entries?.length) {
            line.AddError(
              'Invoice',
              `Free text invoice (${displayInvoice}) not exists in D365FO`,
            );
          } else {
            const postedEntries = entries.filter((e) => e.isPosted);

            if (postedEntries.length === 0) {
              line.AddError(
                'Invoice',
                `(${displayInvoice}) exists in D365FO but is not posted (IsPosted=No)`,
              );
            }
          }
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
      // Associate 223304 withholding rows so vendor MarkedLines can set
      // HasWithHoldingLine when the related settlement line is present.
      // Custody Settlement + any 223304 in the UniqueId → suppress marking
      // on vendor lines and append "Unmarked" to the description.
      const withholdingLines = lines.filter((line) =>
        this.isWithholdingLedgerLine(line),
      );
      const isCustodySettlementGroup =
        lines[0]?.SafeType === 'Custody Settlement';
      const suppressSettlementMarking =
        isCustodySettlementGroup && withholdingLines.length > 0;
      return lines.map((line) =>
        this.buildSourceLineOutbound(
          sourceId,
          line,
          exchangeRateContext,
          line.IsVendor
            ? this.findWithholdingLine(line, withholdingLines)
            : undefined,
          { suppressSettlementMarking },
        ),
      );
    }

    const specialCase = this.cashInCustomerFxResults.get(sourceId);
    if (specialCase) {
      return this.buildCashInCustomerFxLines(
        sourceId,
        lines,
        specialCase,
        exchangeRateContext,
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
    const offsetLines = lines.filter(
      (line) =>
        Number(line.CREDITAMOUNT) > 0 && !this.isWithholdingLedgerLine(line),
    );

    if (vendorLines.length === 0 || offsetLines.length > 1) {
      const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: 'Vendor Payment',
      });
      invalid.AddError(
        'InvalidMapping',
        `Vendor Payment requires (a) one or more debit Vendor lines with either one credit payment offset or none, or (b) Ledger-only main-account-only lines. Found ${vendorLines.length} Vendor line(s) and ${offsetLines.length} payment offset(s).`,
      );
      return [invalid];
    }

    // No payment offset: post each vendor debit as a single-sided
    // (main-account-only) journal line. Withholding rows stay on MarkedLines
    // and are not posted separately — same as the offset-merge path.
    if (offsetLines.length === 0) {
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
   * Vendor Payment offset rule (only when the UniqueId includes 223304
   * withholding ledger credits):
   *
   * UniqueId shape: N debit Vendor lines + exactly one non-223304 credit
   * payment offset (+ optional 223304 withholding credits)
   * → one FO journal line per vendor debit line:
   *   - Account = vendor
   *   - Offset = shared payment account (Petty Cash / Bank / Ledger / …)
   *   - DebitAmount = vendor DEBITAMOUNT − withholding allocated to that vendor
   *   - CreditAmount = 0
   * → one additional FO journal line per matched 223304 withholding row:
   *   - Account = matched vendor (exact invoice, then accounting shape)
   *   - Offset = withholding ledger
   *   - DebitAmount = withholding CREDITAMOUNT (preserved)
   *   - Each withholding row assigned once only
   *   - No MarkedLines (settlement stays on the payment line only —
   *     double-marking the same invoice in one VendPaym TTS makes FO
   *     reject with "marked for settlement by … this journal")
   */
  private mergeVendorPaymentLinesWithOffset(
    sourceId: string,
    vendorLines: CashEntryRawDataModel[],
    paymentOffset: CashEntryRawDataModel,
    withholdingLines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    if (withholdingLines.length > 0) {
      const balanceError = this.validateVendorPaymentWithholdingBalance(
        vendorLines,
        paymentOffset,
        withholdingLines,
      );
      if (balanceError) {
        const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
          SourceIds: [sourceId],
          SafeType: 'Vendor Payment',
        });
        invalid.AddError('UnbalancedWithholding', balanceError);
        return [invalid];
      }
    }

    const results: CashEntryDynDataModel[] = [];
    const assignments = this.assignWithholdingLinesToVendors(
      vendorLines,
      withholdingLines,
    );
    const withholdingReductionMap = this.buildWithholdingReductionMap(
      vendorLines,
      withholdingLines,
      assignments,
    );

    for (const vendorLine of vendorLines) {
      const matchedWithholding = assignments.get(vendorLine) ?? [];
      const primaryWithholding = matchedWithholding[0];

      // Every payment line settling an invoice that carries a 223304 row must
      // report the withholding (HasWithHoldingLine + IsWithholdingCalculation
      // Enabled) so D365 applies it to the whole settlement — not just the
      // vendor that owns the companion FO line. Companion emission is driven
      // only by `matchedWithholding` (each 223304 row once).
      const withholdingForMark =
        primaryWithholding ??
        this.findWithholdingLine(vendorLine, withholdingLines);

      // Payment offset merge: always take the vendor debit amount from the
      // ACCOUNT (vendor) row — never substitute the shared payment credit.
      // Matched withholding is deducted so the vendor line posts at the net
      // amount; the 223304 companion below carries the withheld portion.
      results.push(
        this.buildLineOutbound(
          sourceId,
          vendorLine,
          paymentOffset,
          'ACCOUNT',
          exchangeRateContext,
          [{ vendorLine, withholdingLine: withholdingForMark }],
          withholdingReductionMap.get(vendorLine) ?? 0,
        ),
      );

      for (const withholdingLine of matchedWithholding) {
        // Separate FO line for 223304: vendor account + withholding offset,
        // amount preserved from the withholding credit. Pass [] so this line
        // does not settle — the payment line above already marked the invoice.
        results.push(
          this.buildLineOutbound(
            sourceId,
            vendorLine,
            withholdingLine,
            'OFFSET',
            exchangeRateContext,
            [],
          ),
        );
      }
    }

    return results;
  }

  /**
   * Assign each 223304 withholding credit to exactly one vendor in the group.
   *
   * Priority 1: exact invoice match (normalizeInvoice; "156" ≠ "1567").
   * Priority 2: among invoice matches, highest accounting-shape score.
   * Priority 3: identical shape → lowest LINENUMBER (deterministic).
   * Fallback: single-vendor UniqueId may absorb an unmatched withholding row.
   */
  private assignWithholdingLinesToVendors(
    vendorLines: CashEntryRawDataModel[],
    withholdingLines: CashEntryRawDataModel[],
  ): Map<CashEntryRawDataModel, CashEntryRawDataModel[]> {
    const assignments = new Map<
      CashEntryRawDataModel,
      CashEntryRawDataModel[]
    >();
    for (const vendorLine of vendorLines) {
      assignments.set(vendorLine, []);
    }
    if (withholdingLines.length === 0 || vendorLines.length === 0) {
      return assignments;
    }

    const orderedWithholding = [...withholdingLines].sort(
      (a, b) => Number(a.LINENUMBER ?? 0) - Number(b.LINENUMBER ?? 0),
    );

    for (const withholdingLine of orderedWithholding) {
      const selected = this.selectVendorForWithholdingLine(
        withholdingLine,
        vendorLines,
      );
      if (!selected) continue;
      assignments.get(selected)!.push(withholdingLine);
    }

    return assignments;
  }

  private selectVendorForWithholdingLine(
    withholdingLine: CashEntryRawDataModel,
    vendorLines: CashEntryRawDataModel[],
  ): CashEntryRawDataModel | undefined {
    const withholdingInvoice = this.sanitizeInvoiceOutbound(
      withholdingLine.INVOICE,
    );

    let eligible = withholdingInvoice
      ? vendorLines.filter(
          (vendorLine) =>
            this.sanitizeInvoiceOutbound(vendorLine.INVOICE) ===
            withholdingInvoice,
        )
      : [];

    // Single-vendor UniqueId: allow match when the vendor invoice is blank but
    // the withholding row carries the settlement invoice (or vice versa).
    if (eligible.length === 0 && vendorLines.length === 1) {
      eligible = [...vendorLines];
    }

    if (eligible.length === 0) return undefined;
    if (eligible.length === 1) return eligible[0];

    return [...eligible].sort((a, b) => {
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
   * Compute the net withholding reduction per vendor payment line.
   *
   * When a 223304 withholding row exists for an invoice, every vendor line
   * settling that invoice is reduced proportionally so the group posts exactly
   * (gross − withheld) to the payment offset, while the separate 223304
   * companion line (assigned once via invoice/shape matching) records the
   * withheld amount. The rounding remainder is absorbed by the last line so
   * the total reduction equals the withholding total exactly.
   *
   * Assigned withholding that could not be keyed by invoice (e.g. blank
   * vendor invoice on a single-vendor UniqueId) reduces that vendor directly.
   */
  private buildWithholdingReductionMap(
    vendorLines: CashEntryRawDataModel[],
    withholdingLines: CashEntryRawDataModel[],
    assignments?: Map<CashEntryRawDataModel, CashEntryRawDataModel[]>,
  ): Map<CashEntryRawDataModel, number> {
    const reductions = new Map<CashEntryRawDataModel, number>();

    const withholdingByInvoice = new Map<string, number>();
    for (const wLine of withholdingLines) {
      const invoice = this.sanitizeInvoiceOutbound(wLine.INVOICE);
      if (!invoice) continue;
      const amount = Number(wLine.CREDITAMOUNT ?? wLine.DEBITAMOUNT ?? 0);
      withholdingByInvoice.set(
        invoice,
        this.roundMoney((withholdingByInvoice.get(invoice) ?? 0) + amount),
      );
    }

    const linesByInvoice = new Map<string, CashEntryRawDataModel[]>();
    for (const vendorLine of vendorLines) {
      const invoice = this.sanitizeInvoiceOutbound(vendorLine.INVOICE);
      if (!invoice || !withholdingByInvoice.has(invoice)) continue;
      if (!linesByInvoice.has(invoice)) linesByInvoice.set(invoice, []);
      linesByInvoice.get(invoice)!.push(vendorLine);
    }

    for (const [, lines] of linesByInvoice) {
      const invoice = this.sanitizeInvoiceOutbound(lines[0].INVOICE);
      const withholdingTotal = withholdingByInvoice.get(invoice)!;
      const grossTotal = this.roundMoney(
        lines.reduce((sum, line) => sum + Number(line.DEBITAMOUNT ?? 0), 0),
      );
      if (grossTotal <= 0 || withholdingTotal <= 0) continue;

      let applied = 0;
      lines.forEach((line, index) => {
        const lineGross = Number(line.DEBITAMOUNT ?? 0);
        const isLast = index === lines.length - 1;
        const rawShare = lineGross * (withholdingTotal / grossTotal);
        const reduction = Math.max(
          0,
          Math.min(
            lineGross,
            this.roundMoney(isLast ? withholdingTotal - applied : rawShare),
          ),
        );
        applied = this.roundMoney(applied + reduction);
        reductions.set(line, reduction);
      });
    }

    if (assignments) {
      for (const vendorLine of vendorLines) {
        if (reductions.has(vendorLine)) continue;
        const assigned = assignments.get(vendorLine) ?? [];
        if (assigned.length === 0) continue;
        const amount = this.roundMoney(
          assigned.reduce(
            (sum, line) =>
              sum + Number(line.CREDITAMOUNT ?? line.DEBITAMOUNT ?? 0),
            0,
          ),
        );
        reductions.set(
          vendorLine,
          Math.max(0, Math.min(Number(vendorLine.DEBITAMOUNT ?? 0), amount)),
        );
      }
    }

    return reductions;
  }

  /**
   * Source-group balance for Vendor Payment + withholding:
   * totalVendorDebit === totalNormalPaymentCredit + totalWithholdingCredit
   */
  private validateVendorPaymentWithholdingBalance(
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

    if (
      !this.areMoneyAmountsEqual(
        totalVendorDebit,
        totalNormalPaymentCredit + totalWithholdingCredit,
      )
    ) {
      return (
        `Vendor Payment with withholding is unbalanced for this UniqueId: ` +
        `vendorDebit=${totalVendorDebit}, normalPaymentCredit=${totalNormalPaymentCredit}, ` +
        `withholdingCredit=${totalWithholdingCredit} ` +
        `(expected normalPaymentCredit=${expectedPayment}).`
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
      ItemWithholdingTaxGroupCode: offsetLine.ITEMWITHHOLDINGTAXGROUPCODE,
      OffsetCompany: this.company,
      PostingProfile: this.resolvePostingProfileForAccount(
        accountLine.ACCOUNTTYPE,
        accountLine.POSTINGPROFILE,
        offsetLine.POSTINGPROFILE,
      ),
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
    // `settlements === []` → intentional no settlement (e.g. Vendor Payment
    // 223304 withholding companion line; payment line already marked).
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

    const rawInvoice =
      primarySettlement.vendorLine.MARKEDINVOICE ||
      offsetLine.MARKEDINVOICE ||
      primarySettlement.vendorLine.INVOICE ||
      offsetLine.INVOICE ||
      primarySettlement.vendorLine.DOCUMENT ||
      offsetLine.DOCUMENT;
    const sanitizedInvoice = suppressSettlement
      ? ''
      : this.sanitizeInvoiceOutbound(rawInvoice);

    // WHT companion lines are not unmarked settlements — they simply do not
    // settle. Keep the payment description without a "- unmarked" suffix.
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
          ? Math.max(
              0,
              normalizedSettlements.reduce(
                (sum, { vendorLine }) =>
                  sum + Number(vendorLine.DEBITAMOUNT ?? 0),
                0,
              ) - withholdingReduction,
            )
          : offsetLine.CREDITAMOUNT,
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ExchangeRate: exchangeRate,
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
    withholdingLine?: CashEntryRawDataModel,
    options?: { suppressSettlementMarking?: boolean },
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

    const offsetDimensionString =
      sourceLine.OFFSETACCOUNTTYPE === 'Ledger'
        ? sourceLine.OFFSETACCOUNTDISPLAYVALUE
        : sourceLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE;
    const offsetDimensions = this.omitFleetWorkerDimension(
      this.utilsService.parseDimensionString(offsetDimensionString),
    );
    let description = `${route?.safeType ?? sourceLine.SafeType} - ${this.getCollectionDescriptionLabel()} ${this.utilsService.formatMonthYear(sourceLine.TRANSDATE)}${sourceLine.VoucherType ? ` (${sourceLine.VoucherType})` : ''}`;
    const isCustodySettlement =
      sourceLine.IsCustodySettlement ||
      route?.safeType === 'Custody Settlement';
    const isVendorPayment =
      sourceLine.IsVendorPayment || route?.safeType === 'Vendor Payment';
    const supportsSettlementMarking = isVendorPayment || isCustodySettlement;
    const suppressSettlementMarking = Boolean(
      options?.suppressSettlementMarking,
    );
    const sourceHasWithholding =
      this.isWithholdingLedgerLine(sourceLine) ||
      String(sourceLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
        'yes' ||
      Boolean(sourceLine.ITEMWITHHOLDINGTAXGROUPCODE) ||
      Boolean(withholdingLine);
    const vendorGroup = String(sourceLine.VendorGroup ?? '').trim();
    const isCustodyVendor =
      sourceLine.IsCustodyVendor || vendorGroup.toLowerCase() === 'custody';
    // Vendor Payment and Custody Settlement emit MarkedLines for vendor rows.
    // Custody Settlement UniqueIds that include a 223304 withholding credit
    // intentionally leave vendor lines unmarked.
    const markedLine =
      supportsSettlementMarking &&
      sourceLine.IsVendor &&
      !suppressSettlementMarking
        ? this.buildMarkedLine(sourceLine, withholdingLine)
        : undefined;
    const hasSettlementTarget = Boolean(
      markedLine &&
      (markedLine.InvoiceNumber ||
        markedLine.DocumentNumber ||
        markedLine.OperationNumber),
    );
    const markedLines = hasSettlementTarget && markedLine ? [markedLine] : [];
    const markedInvoice =
      supportsSettlementMarking &&
      sourceLine.IsVendor &&
      !isCustodyVendor &&
      !suppressSettlementMarking
        ? this.sanitizeInvoiceOutbound(
            sourceLine.MARKEDINVOICE ||
              sourceLine.INVOICE ||
              sourceLine.DOCUMENT,
          )
        : '';

    let transactionText = sourceLine.TEXT || description;
    if (
      isCustodySettlement &&
      sourceLine.IsVendor &&
      suppressSettlementMarking
    ) {
      if (!description.toLowerCase().includes('unmarked')) {
        description = `${description} - Unmarked`;
      }
      if (!transactionText.toLowerCase().includes('unmarked')) {
        transactionText = `${transactionText} - Unmarked`;
      }
    }

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: transactionText,
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
      IsWithholdingCalculationEnabled:
        (isCustodySettlement || isVendorPayment) && sourceHasWithholding
          ? 'Yes'
          : 'No',
      ItemWithholdingTaxGroupCode:
        isCustodySettlement || isVendorPayment
          ? sourceLine.ITEMWITHHOLDINGTAXGROUPCODE ||
            withholdingLine?.ITEMWITHHOLDINGTAXGROUPCODE ||
            ''
          : '',
      OffsetCompany: this.company,
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
      MarkedLines: markedLines,
      VendorGroup: sourceLine.IsVendor ? vendorGroup : '',
      dataAreaId: this.company,
      ExchRateSecond: 0,
      Document: sourceLine.DOCUMENT,
      DocumentDate: sourceLine.DOCUMENTDATE,
      DueDate: sourceLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: route?.safeType ?? sourceLine.SafeType,
      // Settlement targets for Vendor Payment and Custody Settlement vendor
      // rows. Suppressed when Custody Settlement UniqueId includes 223304.
      SettlementTargetType:
        supportsSettlementMarking &&
        sourceLine.IsVendor &&
        !suppressSettlementMarking
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
  protected async applyCashInCustomerForeignCurrencyRules(
    lines: CashEntryRawDataModel[],
  ): Promise<CashEntryRawDataModel[]> {
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

  protected buildCashInCustomerFxLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    specialCase: CashInCustomerFxSpecialCaseResult,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    if (specialCase.isInvalid) {
      const errorLine = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: lines[0]?.SafeType,
        VoucherType: lines[0]?.VoucherType,
      });

      for (const validationError of specialCase.validationErrors) {
        const detailSuffix = validationError.details
          ? ` ${JSON.stringify(validationError.details)}`
          : '';
        errorLine.AddError(
          validationError.field,
          `${validationError.message}${detailSuffix}`,
        );
      }

      if (specialCase.validationErrors.length === 0) {
        errorLine.AddError(
          'CustomerDebitMatch',
          'Unable to determine a unique debit line for the customer Cash-In line.',
        );
      }

      return [errorLine];
    }

    const built: CashEntryDynDataModel[] = [];

    for (const pair of specialCase.matchedPairs) {
      // Exact pair only — never fan the customer across residual offsets.
      built.push(
        this.buildLineInbound(
          sourceId,
          pair.customerLine,
          pair.debitLine,
          'OFFSET',
          exchangeRateContext,
        ),
      );
    }

    const residualLines = specialCase.residualLines.filter((line) =>
      lines.includes(line),
    );

    if (residualLines.length === 0) {
      return built;
    }

    if (residualLines.length === 2) {
      built.push(
        ...this.caseTwoLines(sourceId, residualLines, exchangeRateContext),
      );
    } else {
      built.push(
        ...this.caseMoreThanTwoLines(
          sourceId,
          residualLines,
          exchangeRateContext,
        ),
      );
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

    for (const [index, line] of groupLines.entries()) {
      const lineId = cashInLineStableId(line, index);
      if (!result.skippedLedgerLineIds.has(lineId)) continue;

      this.logger.log(
        `Cash-In Ledger line skipped because AccountType is Ledger and the main account starts with 421103. ${JSON.stringify(
          {
            uniqueId: result.uniqueId,
            voucher: line.VOUCHER || voucher,
            ledgerLineNumber: line.LINENUMBER,
            accountDisplayValue: line.ACCOUNTDISPLAYVALUE,
            extractedMainAccount: extractCashInMainAccount(
              line.ACCOUNTDISPLAYVALUE,
            ),
            debitAmount: line.DEBITAMOUNT,
            creditAmount: line.CREDITAMOUNT,
            currency: line.CURRENCYCODE,
            invoice: line.INVOICE,
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
    // Keep residual Cash-In settlement filtering aligned with the special-case
    // Ledger 421103 rule (case-insensitive AccountType + startsWith).
    if (isCashInLedger421103Line(line)) {
      return true;
    }

    const accountType = normalizeCashInAccountType(line.ACCOUNTTYPE);
    const mainAccount =
      dimensions.mainAccount ||
      extractCashInMainAccount(line.ACCOUNTDISPLAYVALUE);

    if (accountType !== 'ledger') return false;
    if (!mainAccount) return false;

    return this.SETTLEMENT_MAIN_ACCOUNTS.some((account) =>
      mainAccount.startsWith(account),
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
        .map((value) => value?.trim() ?? '')
        .find(Boolean) ?? ''
    );
  }

  /**
   * Cash-out invoice sanitization: coerce to string, trim; drop empty /
   * all-zero placeholders (0, 00, 000, ...). Exact match only after normalize
   * ("156" does not match "1567"). Does not use cash-in number/text formatting.
   */
  protected sanitizeInvoiceOutbound(invoice?: string | number): string {
    const trimmed = String(invoice ?? '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .trim();
    if (!trimmed) return '';
    if (/^0+$/.test(trimmed)) return '';
    return trimmed;
  }

  protected isWithholdingLedgerLine(line: CashEntryRawDataModel): boolean {
    const accountType = String(line.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const mainAccount = String(line.ACCOUNTDISPLAYVALUE ?? '')
      .trim()
      .split('|')[0]
      .trim();
    return accountType === 'ledger' && mainAccount.startsWith('223304');
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
                }).safeType === 'Vendor Payment'
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
   * Bank / Petty cash / RCash account ids must be BankAccountTable (or RCash)
   * ids — never a ledger dimension string like `122201|1301|013|001|`.
   * Notes-receivable Cash-In forces OffsetAccountType=Bank; missing bank
   * segment must fail at format/validate, not at FO post.
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
