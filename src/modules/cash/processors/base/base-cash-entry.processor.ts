import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { capitalize } from '@/lib/utils';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  findCashBankMisclassificationError,
  resolveCashAccountType,
  validateCashLedgerAccountCurrency,
} from '@/modules/cash/policies/cash-account-classification.policy';
import {
  isCash22420LedgerDimensionLine,
  isCashNotesReceivableLine,
  resolveCashOutboundInvoice,
} from '@/modules/cash/policies/cash-account.policy';
import {
  assignCashMissingUniqueIds,
  classifyCashLines,
} from '@/modules/cash/policies/cash-batch.policy';
import {
  resolveCashOffsetAccountDisplayValue,
  toCashDefaultDimensionDisplayValue,
} from '@/modules/cash/policies/cash-dimension.policy';
import {
  firstCashFinancialTag,
  replaceCashShippingLineWithVendorName,
  validateCashInboundInvoice,
} from '@/modules/cash/policies/cash-invoice.policy';
import {
  getCashCollectionDescriptionLabel,
  resolveCashJournalName,
} from '@/modules/cash/policies/cash-journal.policy';
import { resolveCashPaymentMethod } from '@/modules/cash/policies/cash-line.policy';
import { CashIn421103CurrencyPolicy } from '@/modules/cash/policies/cash-in-421103-currency.policy';
import { mapCashRawData } from '@/modules/cash/policies/cash-normalization.policy';
import {
  analyzeCashWithholding,
  isCashWithholdingLedgerLine,
} from '@/modules/cash/policies/cash-withholding.policy';
import {
  groupVendorPaymentValidationLines,
  resolveVendorPaymentMarking,
  VendorInvoiceMatchStatus,
  VendorInvoiceVerificationService,
} from '@/modules/cash/processors/outbound/vendor-payment';
import { CustodyIssueBuilder } from '@/modules/cash/processors/outbound/custody-issue/custody-issue.builder';
import { CustodySettlementBuilder } from '@/modules/cash/processors/outbound/custody-settlement/custody-settlement.builder';
import { validateCustodySettlementVendorInvoiceShape } from '@/modules/cash/processors/outbound/custody-settlement/custody-settlement.validator';
import { CashOutEntryBuilder } from '@/modules/cash/processors/outbound/cash-out-entry.builder';
import { VendorPaymentLineBuilder } from '@/modules/cash/processors/outbound/vendor-payment/vendor-payment-line.builder';
import {
  buildCashLine,
  buildCashMoreThanTwoLines,
  buildCashTwoLines,
} from '@/modules/cash/services/cash-group-line-building.service';
import {
  buildCashInboundInvalidLine,
  createCashInboundDynamicLine,
  formatCashInboundDescription,
  prepareCashInboundDimensions,
  resolveCashInboundDerivedValues,
  resolveCashInboundRates,
} from '@/modules/cash/services/cash-in-line-building.service';
import {
  CashJournalRoute,
  CashJournalRoutingError,
  CashJournalRoutingService,
} from '@/modules/cash/services/cash-journal-routing.service';
import {
  buildCashInvoiceLines,
  buildCashLines,
} from '@/modules/cash/services/cash-line-building.service';
import {
  CashOutExchangeRateContext,
  CashOutExchangeRateResolution,
  CashOutExchangeRateService,
} from '@/modules/cash/services/cash-out-exchange-rate.service';
import { processCashCustodySettlementLines } from '@/modules/cash/services/cash-settlement-processing.service';
import { processCashVendorPaymentLines } from '@/modules/cash/services/cash-vendor-payment-processing.service';
import { VendorPaymentDescriptionPolicy } from '@/modules/cash/processors/outbound/vendor-payment/policies/vendor-payment-description.policy';
import { VendorPaymentSettlementIntent } from '@/modules/cash/processors/outbound/vendor-payment/models/vendor-payment-marking-result';
import {
  CustodySettlementTarget,
  GeneralJournalService,
} from '@/modules/d365fo/services/general-journal.service';
import {
  VendorInvoiceJournalService,
  VendorInvoiceSettlementSnapshot,
} from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { VendorService } from '@/modules/d365fo/services/vendor.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { GetVendorsQuery } from '@/modules/master-data/queries';

type RawDataInvoiceMap = Map<string, CashEntryRawDataModel[]>;

@Injectable()
export abstract class BaseCashEntryProcessor extends EntryProcessorBase {
  protected readonly logger = new Logger(BaseCashEntryProcessor.name);
  private readonly cashJournalRoutingService = new CashJournalRoutingService();
  private readonly vendorInvoiceVerificationService =
    new VendorInvoiceVerificationService();
  private readonly cashOutExchangeRateService: CashOutExchangeRateService;
  private readonly generalJournalService: GeneralJournalService;
  private readonly d365VendorService?: VendorService;

  protected readonly MAX_LINES_PER_BATCH = 1000;

  /**
   * Cash-out: cached D365 invoice snapshots keyed by `invoice|vendor`.
   */
  protected vendorInvoiceSnapshotMap: Map<
    string,
    VendorInvoiceSettlementSnapshot
  > | null = null;

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

    const processedLines = sortedLines;
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

    if (this.isInbound()) {
      for (const [uniqueId, groupLines] of invoiceMap.entries()) {
        const firstLine = groupLines[0];
        CashIn421103CurrencyPolicy.apply({
          uniqueId,
          safeType: firstLine?.SafeType,
          lines: groupLines,
        });
      }
    }

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
        `[STEP 6] Vendor invoice snapshot map size: ${this.vendorInvoiceSnapshotMap?.size ?? 0}`,
      );
    }

    this.logger.debug(
      `[STEP 7] Processing ${custodySettlementLines.length} custody settlement lines`,
    );
    processCashCustodySettlementLines({
      company: this.company,
      lines: custodySettlementLines,
      execute: (command) => this.commandBus.execute(command),
      debug: (message) => this.logger.debug(message),
      error: (message) => this.logger.error(message),
    });

    if (!this.isInbound()) {
      this.logger.debug(
        `[STEP 7] Processing ${vendorPayment.length} vendor payment lines`,
      );
      processCashVendorPaymentLines({
        company: this.company,
        trucking: this.isTrucking(),
        lines: vendorPayment,
        execute: (command) => this.commandBus.execute(command),
        debug: (message) => this.logger.debug(message),
        error: (message) => this.logger.error(message),
      });
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
      if (
        !this.isInbound() &&
        this.unbalancedUniqueIds.has(line.SourceIds[0])
      ) {
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
        const displayInvoice = line.MarkedInvoice || line.Invoice || '';
        const invoiceError = validateCashInboundInvoice(
          displayInvoice,
          (invoiceKey) => this.freeTextInvoiceMap?.get(invoiceKey),
        );

        if (invoiceError) {
          line.AddError('Invoice', invoiceError);
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

        if (
          shouldValidateCashOutMarkedInvoice &&
          line.SafeType === 'Custody Settlement'
        ) {
          for (const error of validateCustodySettlementVendorInvoiceShape(
            line,
          )) {
            line.AddError(error.field, error.message);
          }
        } else if (shouldValidateCashOutMarkedInvoice) {
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
        const linesForVendor = vendorLines.filter(
          (l) =>
            String(l.ACCOUNTDISPLAYVALUE ?? '')
              .trim()
              .toLowerCase() === vendorAccount.toLowerCase(),
        );
        const sourceIds = linesForVendor
          .map((l) => l.UniqueId || '?')
          .join(', ');
        errors.push(
          `Vendor ${vendorAccount} (UniqueId ${sourceIds}): vendor group could not be determined from D365FO. Sync vendor master data and retry.`,
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

    const settlementRequests = normalVendorLines
      .map((line) => ({
        invoice: resolveCashOutboundInvoice(line.MARKEDINVOICE, line.INVOICE),
        vendorAccount: String(line.ACCOUNTDISPLAYVALUE ?? '').trim(),
        documentNumber: String(line.DOCUMENT ?? '').trim(),
        lineNumber: line.LINENUMBER,
      }))
      .filter(
        (request) => Boolean(request.invoice) && Boolean(request.vendorAccount),
      );
    this.vendorInvoiceSnapshotMap =
      await this.vendorInvoiceJournalService.findInvoiceSettlementSnapshots(
        this.company,
        settlementRequests,
      );
    const validationGroups =
      groupVendorPaymentValidationLines(normalVendorLines);
    for (const groupLines of validationGroups) {
      const line = groupLines[0];
      const invoice = resolveCashOutboundInvoice(
        line.MARKEDINVOICE,
        line.INVOICE,
      );
      const vendor = String(line.ACCOUNTDISPLAYVALUE ?? '').trim();
      const addGroupError = (message: string) => {
        for (const sourceLine of groupLines) {
          const uniqueIdTag = sourceLine.UniqueId
            ? ` (UniqueId ${sourceLine.UniqueId})`
            : '';
          errors.push(
            `Line ${sourceLine.LINENUMBER}${uniqueIdTag}: ${message}`,
          );
        }
      };
      if (!invoice) {
        addGroupError(
          `Vendor Payment invoice is required for vendor ${vendor}.`,
        );
        continue;
      }
      const key = VendorInvoiceJournalService.pairKey(invoice, vendor);
      const snapshot = this.vendorInvoiceSnapshotMap.get(key);
      if (!snapshot?.exists) {
        addGroupError(
          `vendor transaction was not found in D365. Vendor: ${vendor}.`,
        );
      } else {
        const hasCandidatesOrAmounts =
          Boolean(snapshot.candidateTransactions?.length) ||
          (typeof snapshot.originalAmount === 'number' &&
            Number.isFinite(snapshot.originalAmount)) ||
          (typeof snapshot.remainingAmount === 'number' &&
            Number.isFinite(snapshot.remainingAmount));

        if (hasCandidatesOrAmounts) {
          const docNum = String(line.DOCUMENT ?? '').trim();
          const vendorDebit = groupLines.reduce(
            (sum, sourceLine) => sum + Number(sourceLine.DEBITAMOUNT ?? 0),
            0,
          );

          const candidates =
            snapshot.candidateTransactions &&
            snapshot.candidateTransactions.length > 0
              ? snapshot.candidateTransactions
              : [
                  {
                    vendorAccount: snapshot.vendorAccount || vendor,
                    documentNumber: snapshot.documentNumber || docNum,
                    invoiceNumber: snapshot.invoice || invoice,
                    currencyCode:
                      snapshot.currencyCode || String(line.CURRENCYCODE ?? ''),
                    originalAmount: snapshot.originalAmount ?? 0,
                    openAmount:
                      snapshot.remainingAmount ?? snapshot.originalAmount ?? 0,
                    sourceKey: snapshot.sourceKey,
                    lastSettleVoucher: snapshot.lastSettleVoucher,
                    isOpen: snapshot.isOpen ?? true,
                  },
                ];

          const verifyResult = this.vendorInvoiceVerificationService.verify(
            {
              company: this.company,
              vendorAccount: vendor,
              documentNumber: docNum,
              invoiceNumber: invoice,
              grossInvoiceAmount: vendorDebit,
              netPaymentAmount: vendorDebit,
              withholdingAmount: 0,
              currencyCode: String(line.CURRENCYCODE ?? ''),
              allowPartialPayment: false,
              skipAmountValidation: true,
            },
            candidates,
          );

          if (verifyResult.status !== VendorInvoiceMatchStatus.MATCHED) {
            addGroupError(
              verifyResult.reason ?? 'Vendor invoice verification failed',
            );
          } else if (verifyResult.matchedTransaction?.invoiceNumber) {
            // Validation accepts controlled Finance suffix variants (for
            // example source 050 vs D365 050-1). Posting must use the exact
            // D365 identity; the custom settlement endpoint does not apply the
            // middleware's identity-equivalence policy.
            const exactD365Invoice =
              verifyResult.matchedTransaction.invoiceNumber;
            const canonicalInvoice = exactD365Invoice.trim();
            for (const sourceLine of groupLines) {
              sourceLine.MARKEDINVOICE = canonicalInvoice;
              sourceLine.ResolvedD365InvoiceNumber = exactD365Invoice;
            }
          }
        }
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
      } else {
        const match = targetMatches[0];
        // Use the exact D365 identity. Custody issue transactions commonly
        // have a blank invoice and are matched by document/operation/amount.
        line.ResolvedD365InvoiceNumber = String(match.Invoice ?? '');
        line.MARKEDINVOICE = line.ResolvedD365InvoiceNumber;
      }
    }
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
    if (this.isInbound()) {
      this.unbalancedUniqueIds.clear();
      return this.unbalancedUniqueIds;
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

  protected buildInvoiceLines(
    invoiceMap: RawDataInvoiceMap,
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const outboundBuilder = this.createCashOutEntryBuilder();

    return buildCashInvoiceLines({
      invoiceMap,
      exchangeRateContext,
      buildGroupedLines: (sourceId, lines, context) =>
        buildCashLines({
          sourceId,
          lines,
          inbound: this.isInbound(),
          exchangeRateContext: context,
          buildOutbound: (id, groupedLines, context) =>
            outboundBuilder.build(id, groupedLines, context),
          buildTwoLines: (id, groupedLines, context) =>
            this.caseTwoLines(id, groupedLines, context),
          buildManyLines: (id, groupedLines, context) =>
            this.caseMoreThanTwoLines(id, groupedLines, context),
        }),
    });
  }

  /**
   * Compatibility wrapper for existing subclasses/tests. The active pipeline
   * calls `buildCashLines` directly; this wrapper is temporary and delegates
   * without duplicating any routing logic.
   */
  protected buildLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const outboundBuilder = this.createCashOutEntryBuilder();

    return buildCashLines({
      sourceId,
      lines,
      inbound: this.isInbound(),
      exchangeRateContext,
      buildOutbound: (id, groupedLines, context) =>
        outboundBuilder.build(id, groupedLines, context),
      buildTwoLines: (id, groupedLines, context) =>
        this.caseTwoLines(id, groupedLines, context),
      buildManyLines: (id, groupedLines, context) =>
        this.caseMoreThanTwoLines(id, groupedLines, context),
    });
  }

  private createCashOutEntryBuilder(): CashOutEntryBuilder {
    const buildSourceLine = (
      id: string,
      line: CashEntryRawDataModel,
      context?: CashOutExchangeRateContext,
    ) => this.buildSourceLineOutbound(id, line, context);

    return new CashOutEntryBuilder(
      new VendorPaymentLineBuilder(
        (
          id,
          accountLine,
          offsetLine,
          amountSource,
          context,
          settlements,
          disableAutomaticWithholdingCalculation,
        ) =>
          this.buildLineOutbound(
            id,
            accountLine,
            offsetLine,
            amountSource,
            context,
            settlements,
            disableAutomaticWithholdingCalculation,
          ),
      ),
      new CustodySettlementBuilder(buildSourceLine),
      new CustodyIssueBuilder(buildSourceLine),
      buildSourceLine,
    );
  }

  protected caseTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    return buildCashTwoLines({
      sourceId,
      lines,
      inbound: this.isInbound(),
      exchangeRateContext,
      buildLine: (id, accountLine, offsetLine, amountSource, context) =>
        buildCashLine({
          inbound: this.isInbound(),
          sourceId: id,
          accountLine,
          offsetLine,
          amountSource,
          exchangeRateContext: context,
          buildInbound: (lineId, account, offset, source, rateContext) =>
            this.buildLineInbound(lineId, account, offset, source, rateContext),
          buildOutbound: (lineId, account, offset, source, rateContext) =>
            this.buildLineOutbound(
              lineId,
              account,
              offset,
              source,
              rateContext,
            ),
        }),
    });
  }

  protected caseMoreThanTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    return buildCashMoreThanTwoLines({
      sourceId,
      lines,
      inbound: this.isInbound(),
      exchangeRateContext,
      buildLine: (id, accountLine, offsetLine, amountSource, context) =>
        buildCashLine({
          inbound: this.isInbound(),
          sourceId: id,
          accountLine,
          offsetLine,
          amountSource,
          exchangeRateContext: context,
          buildInbound: (lineId, account, offset, source, rateContext) =>
            this.buildLineInbound(lineId, account, offset, source, rateContext),
          buildOutbound: (lineId, account, offset, source, rateContext) =>
            this.buildLineOutbound(
              lineId,
              account,
              offset,
              source,
              rateContext,
            ),
        }),
      parseDimensionString: (displayValue) =>
        this.utilsService.parseDimensionString(displayValue),
    });
  }

  protected buildLineInbound(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel {
    const { segmentLength, dimensions, clearedBankAccountDimension } =
      prepareCashInboundDimensions({
        accountLine,
        offsetLine,
        getDimensionSegmentLength: (displayValue) =>
          this.utilsService.getDimensionSegmentLength(displayValue),
        parseDimensionString: (displayValue) =>
          this.utilsService.parseDimensionString(displayValue),
        filterDimensionsForLedgerTag22420: (parsedDimensions) =>
          this.utilsService.filterDimensionsForLedgerTag22420(parsedDimensions),
      });

    if (!accountLine || !offsetLine) {
      return buildCashInboundInvalidLine(
        sourceId,
        accountLine,
        offsetLine,
        dimensions,
      );
    }

    if (clearedBankAccountDimension) {
      this.logger.warn(
        `Cash-In cleared an invalid BankAccount financial-dimension value that ` +
          `duplicated a Ledger main account and cannot resolve against BankAccountTable. ` +
          `UniqueId=${sourceId} Voucher=${accountLine.VOUCHER} ClearedValue=${clearedBankAccountDimension}`,
      );
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
    const { description, paymentReference } = formatCashInboundDescription({
      accountLine,
      offsetLine,
      isNotesReceivable,
      label,
      formattedDate,
    });

    const {
      dimensionDisplayValue: dimensionStr,
      currencyCode,
      currencyChanged,
      previousCustomerCurrencyCode,
      transactionDate,
      markedInvoice,
    } = resolveCashInboundDerivedValues({
      accountLine,
      offsetLine,
      dimensions,
      amountSource,
    });

    if (currencyChanged) {
      this.logger.log(
        `Cash-In customer currency aligned with paired non-customer line. ` +
          `UniqueId=${sourceId} Voucher=${accountLine.VOUCHER} CustomerLine=${accountLine.LINENUMBER} SourceLine=${offsetLine.LINENUMBER} ` +
          `CustomerAccount=${accountLine.ACCOUNTDISPLAYVALUE} SourceAccount=${offsetLine.ACCOUNTDISPLAYVALUE} ` +
          `PreviousCurrency=${previousCustomerCurrencyCode} ResolvedCurrency=${currencyCode} ` +
          `DebitAmount=${offsetLine.DEBITAMOUNT} CreditAmount=${accountLine.CREDITAMOUNT}`,
      );
    }

    const { exchangeRate, reportingRate } = resolveCashInboundRates({
      exchangeRateContext,
      transactionDate,
      currencyCode,
      resolveReporting: (context, date, currency) =>
        this.cashOutExchangeRateService.resolveReporting(
          context,
          date ?? '',
          currency ?? '',
        ),
      fetchLegacyRates: (date, currency) =>
        this.fetchExchangeRates(date ?? '', currency ?? ''),
    });

    const resolvedAccountType = resolveCashAccountType(
      accountLine.ACCOUNTDISPLAYVALUE,
      accountLine.ACCOUNTTYPE,
    );
    const resolvedOffsetAccountType = isNotesReceivable
      ? 'Bank'
      : resolveCashAccountType(
          offsetLine.ACCOUNTDISPLAYVALUE,
          offsetLine.ACCOUNTTYPE,
        );

    if (resolvedAccountType !== accountLine.ACCOUNTTYPE) {
      this.logger.log(
        `Cash-In account resolved as Ledger Main Account. ` +
          `UniqueId=${sourceId} Voucher=${accountLine.VOUCHER} LineNumber=${accountLine.LINENUMBER} ` +
          `SourceAccountType=${accountLine.ACCOUNTTYPE} ResolvedAccountType=${resolvedAccountType} ` +
          `AccountDisplayValue=${accountLine.ACCOUNTDISPLAYVALUE} Currency=${accountLine.CURRENCYCODE}`,
      );
    }
    if (resolvedOffsetAccountType !== offsetLine.ACCOUNTTYPE) {
      this.logger.log(
        `Cash-In account resolved as Ledger Main Account. ` +
          `UniqueId=${sourceId} Voucher=${offsetLine.VOUCHER} LineNumber=${offsetLine.LINENUMBER} ` +
          `SourceAccountType=${offsetLine.ACCOUNTTYPE} ResolvedAccountType=${resolvedOffsetAccountType} ` +
          `AccountDisplayValue=${offsetLine.ACCOUNTDISPLAYVALUE} Currency=${offsetLine.CURRENCYCODE}`,
      );
    }

    const accountCurrencyWarning = validateCashLedgerAccountCurrency(
      accountLine.ACCOUNTDISPLAYVALUE,
      currencyCode,
    );
    if (accountCurrencyWarning) this.logger.warn(accountCurrencyWarning);
    const offsetCurrencyWarning = validateCashLedgerAccountCurrency(
      offsetLine.ACCOUNTDISPLAYVALUE,
      currencyCode,
    );
    if (offsetCurrencyWarning) this.logger.warn(offsetCurrencyWarning);

    const dynLine = createCashInboundDynamicLine(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: resolvedAccountType,
      OffsetAccountType: resolvedOffsetAccountType,
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

    const accountBankMisclassification = findCashBankMisclassificationError(
      dynLine.AccountType,
      accountLine.ACCOUNTDISPLAYVALUE,
    );
    if (accountBankMisclassification) {
      dynLine.AddError('AccountType', accountBankMisclassification);
    }
    const offsetBankMisclassification = findCashBankMisclassificationError(
      dynLine.OffsetAccountType,
      offsetLine.ACCOUNTDISPLAYVALUE,
    );
    if (offsetBankMisclassification) {
      dynLine.AddError('OffsetAccountType', offsetBankMisclassification);
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
    disableAutomaticWithholdingCalculation = false,
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
    const primarySettlement = normalizedSettlements[0];
    const markingResult = resolveVendorPaymentMarking({
      settlements: normalizedSettlements,
      offsetLine,
      vendorGroup: String(accountLine.VendorGroup ?? '').trim(),
    });
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

    const rawInvoice = resolveCashOutboundInvoice(
      primarySettlement.vendorLine.MARKEDINVOICE,
      primarySettlement.vendorLine.INVOICE,
    );
    const sanitizedInvoice = markingResult.markedInvoice;

    const descriptionSuffix = markingResult.shouldMark ? '' : ' - unmarked';
    const isVendorPaymentRoute = route?.safeType === 'Vendor Payment';
    const description = isVendorPaymentRoute
      ? new VendorPaymentDescriptionPolicy().getDescription({
          settlementState: markingResult.shouldMark
            ? VendorPaymentSettlementIntent.MARKED
            : VendorPaymentSettlementIntent.UNMARKED,
          target: label,
          monthYear: formattedDate,
          voucherType: accountLine.VoucherType,
          invoiceNumber: rawInvoice,
        })
      : `${route?.safeType ?? 'Vendor Payment'} - ${label} ${formattedDate} (${accountLine.VoucherType})${descriptionSuffix}`;

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
        route?.journalName ??
        resolveCashJournalName({
          inbound: this.isInbound(),
          trucking: this.isTrucking(),
          safeType: accountLine.SafeType,
          resolveRoute: (safeType) => this.resolveCashOutJournalRoute(safeType),
        }),
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
          : Number(offsetLine.CREDITAMOUNT ?? offsetLine.DEBITAMOUNT ?? 0),
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: dimensionStr,
      OffsetDefaultDimensionDisplayValue: dimensionStr,
      SalesTaxGroup: isTaxable ? 'Taxable' : 'Non-Taxabl',
      ItemSalesTaxGroup: itemSalesTaxGroup,
      IsWithholdingCalculationEnabled:
        isWithholding && !disableAutomaticWithholdingCalculation ? 'Yes' : 'No',
      ItemWithholdingTaxGroupCode:
        primarySettlement.vendorLine.ITEMWITHHOLDINGTAXGROUPCODE ||
        primarySettlement.withholdingLine?.ITEMWITHHOLDINGTAXGROUPCODE ||
        offsetLine.ITEMWITHHOLDINGTAXGROUPCODE,
      OffsetCompany: this.company,
      PostingProfile:
        accountLine.POSTINGPROFILE?.trim() ||
        offsetLine.POSTINGPROFILE?.trim() ||
        '',
      Invoice: rawInvoice,
      MarkedInvoice: sanitizedInvoice,
      MarkedLines: [...markingResult.markedLines],
      SettlementIntent: markingResult.shouldMark ? 'Marked' : 'Unmarked',
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
        route?.journalName ??
        resolveCashJournalName({
          inbound: this.isInbound(),
          trucking: this.isTrucking(),
          safeType: sourceLine.SafeType,
          resolveRoute: (safeType) => this.resolveCashOutJournalRoute(safeType),
        }),
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
      Invoice: resolveCashOutboundInvoice(sourceLine.INVOICE),
      MarkedInvoice: '',
      SettlementIntent: 'None',
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
            if (line.SafeType === 'Custody Settlement') return false;
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
            (line.MarkedLines ?? []).map((markedLine) =>
              String(markedLine.InvoiceNumber ?? '').trim(),
            ),
          )
          .filter((invoice) => Boolean(invoice)),
      ),
    ];

    if (invoices.length === 0) {
      this.vendorInvoiceSnapshotMap = new Map();
      this.logger.debug(
        '[LOOKUP] No cash-out marked invoices to resolve; skipping VendTransBiEntities lookup',
      );
      return;
    }

    this.vendorInvoiceSnapshotMap =
      await this.vendorInvoiceJournalService.findInvoiceSettlementSnapshots(
        this.company,
        lines
          .filter(
            (line) =>
              line.SafeType !== 'Custody Settlement' &&
              Boolean(line.AccountDisplayValue?.trim()),
          )
          .flatMap((line) =>
            (line.MarkedLines ?? [])
              .map((markedLine) => ({
                invoice: String(markedLine.InvoiceNumber ?? '').trim(),
                vendorAccount: String(line.AccountDisplayValue ?? '').trim(),
                documentNumber: String(markedLine.DocumentNumber ?? '').trim(),
              }))
              .filter((request) => Boolean(request.invoice)),
          ),
      );
  }

  /**
   * Sync cash-out MarkedInvoice check using the preloaded pair Set.
   * Empty MarkedInvoice = payment without settle (allowed).
   */
  protected validateCashOutMarkedInvoice(line: CashEntryDynDataModel): void {
    if (!this.vendorInvoiceSnapshotMap) {
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

    const custodyShapeErrors =
      validateCustodySettlementVendorInvoiceShape(line);
    if (custodyShapeErrors.length > 0) {
      for (const error of custodyShapeErrors) {
        line.AddError(error.field, error.message);
      }
      return;
    }

    const markedLines = Array.isArray(line.MarkedLines) ? line.MarkedLines : [];
    if (markedLines.length === 0) return;

    for (const markedLine of markedLines) {
      const invoice = String(markedLine.InvoiceNumber ?? '').trim();
      const lineDoc = String(markedLine.DocumentNumber ?? '').trim();
      if (!invoice) {
        line.AddError(
          'MarkedInvoice',
          'Vendor settlement MarkedLines invoice number is required.',
        );
        continue;
      }
      if (!lineDoc) {
        line.AddError(
          'DocumentNumber',
          `Vendor settlement MarkedLines document number is required for invoice ${invoice}.`,
        );
        continue;
      }

      const key = VendorInvoiceJournalService.pairKey(invoice, vendorAccount);
      const snapshot = this.vendorInvoiceSnapshotMap.get(key);
      if (!snapshot?.exists) {
        line.AddError(
          'MarkedInvoice',
          `Vendor transaction was not found in D365. Vendor: ${vendorAccount}.`,
        );
      } else {
        const hasCandidatesOrAmounts =
          Boolean(snapshot.candidateTransactions?.length) ||
          (typeof snapshot.originalAmount === 'number' &&
            Number.isFinite(snapshot.originalAmount)) ||
          (typeof snapshot.remainingAmount === 'number' &&
            Number.isFinite(snapshot.remainingAmount));

        if (hasCandidatesOrAmounts) {
          const candidates =
            snapshot.candidateTransactions &&
            snapshot.candidateTransactions.length > 0
              ? snapshot.candidateTransactions
              : [
                  {
                    vendorAccount: snapshot.vendorAccount || vendorAccount,
                    documentNumber: snapshot.documentNumber || lineDoc,
                    invoiceNumber: snapshot.invoice || invoice,
                    currencyCode:
                      snapshot.currencyCode || String(line.CurrencyCode ?? ''),
                    originalAmount: snapshot.originalAmount ?? 0,
                    openAmount:
                      snapshot.remainingAmount ?? snapshot.originalAmount ?? 0,
                    sourceKey: snapshot.sourceKey,
                    lastSettleVoucher: snapshot.lastSettleVoucher,
                    isOpen: snapshot.isOpen ?? true,
                  },
                ];

          const isSourceWithholdingSplit =
            Boolean(markedLine.HasWithHoldingLine) &&
            String(line.IsWithholdingCalculationEnabled ?? '').toLowerCase() !==
              'yes';
          const settlementAmount = Math.max(
            Math.abs(Number(line.DebitAmount ?? 0)),
            Math.abs(Number(line.CreditAmount ?? 0)),
          );

          const verifyResult = this.vendorInvoiceVerificationService.verify(
            {
              company: this.company,
              vendorAccount,
              documentNumber: lineDoc,
              invoiceNumber: invoice,
              grossInvoiceAmount: isSourceWithholdingSplit
                ? undefined
                : settlementAmount,
              netPaymentAmount: settlementAmount,
              withholdingAmount: 0,
              currencyCode: String(line.CurrencyCode ?? ''),
              allowPartialPayment: isSourceWithholdingSplit,
              skipAmountValidation: true,
            },
            candidates,
          );

          if (verifyResult.status !== VendorInvoiceMatchStatus.MATCHED) {
            const field =
              verifyResult.status ===
              VendorInvoiceMatchStatus.DOCUMENT_NOT_FOUND
                ? 'DocumentNumber'
                : verifyResult.status ===
                    VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND
                  ? 'Amount'
                  : 'MarkedInvoice';
            line.AddError(
              field,
              verifyResult.reason ?? 'Vendor invoice verification failed',
            );
          }
        }
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
        : resolveCashOutboundInvoice(
            vendorLine.MARKEDINVOICE,
            vendorLine.INVOICE,
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
