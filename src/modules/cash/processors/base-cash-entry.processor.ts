import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { capitalize } from '@/lib/utils';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { ProcessCustodySettlementEntryCommand } from '@/modules/closing/commands/process-custody-settlement-entry.command';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDimensionsModel,
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import {
  ProcessVendorPaymentFreightCommand,
  ProcessVendorPaymentTruckingCommand,
} from '@/modules/vendor/commands';

type RawDataInvoiceMap = Map<string, CashEntryRawDataModel[]>;

@Injectable()
export abstract class BaseCashEntryProcessor extends EntryProcessorBase {
  protected readonly logger = new Logger(BaseCashEntryProcessor.name);

  protected readonly MAX_LINES_PER_BATCH = 1000;

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
  }

  public async formatAndEnrichAsync(
    data: EntryRawDataModel[],
    company: string,
  ): Promise<EntryDynDataModel[]> {
    this.company = company;

    await this.warmupProcessorData({
      customerNames: this.isInbound() ? true : false,
    });

    const rawCount = data.length;
    this.logger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records ${this.isInbound() ? '( Cash-In )' : '( Cash-Out )'}${this.isTrucking() ? ' ( Trucking )' : ' ( Freight )'}`,
    );

    this.logger.debug(`[STEP 1] Mapping ${rawCount} raw records to models`);
    const rawLines = this.mapToModel(data);
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    this.logger.debug(
      `[STEP 1.5] Sorting ${rawLines.length} lines by line number`,
    );
    const sortedLines = this.sortRawDataByLineNumber(rawLines);
    this.logger.debug(`[STEP 1.5] Sorted to ${sortedLines.length} lines`);

    this.logger.debug(
      `[STEP 2] Filtering custody settlements from ${sortedLines.length} lines`,
    );
    const { custodySettlementLines, otherLines, vendorPayment } =
      this.filterLines(sortedLines);
    this.logger.debug(
      `[FILTER] Processed ${sortedLines.length} lines → ${custodySettlementLines.length} custody settlement, ${vendorPayment.length} vendor payment, ${otherLines.length} remaining lines`,
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
    this.checkInvoiceBalancedAfterFx(invoiceMap);

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
    const dfoLines = this.buildInvoiceLines(invoiceMap);
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

      if (this.isTrucking()) {
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

        if (!entries?.length) {
          line.AddError(
            'Invoice',
            `Free text invoice (${line.Invoice}) not exists in D365FO`,
          );
          continue;
        }

        const atLeastOnePosted = entries.some((e) => e.isPosted);

        if (entries.length > 1) {
          const notPostedCount = entries.filter((e) => !e.isPosted).length;
          const duplicateMessage =
            notPostedCount > 0
              ? `Duplicate free text invoices in D365FO: (${line.Invoice}) has ${entries.length} matching records. ${notPostedCount} of these are not posted. Resolve duplicates in D365FO.`
              : `Duplicate free text invoices in D365FO: (${line.Invoice}) has ${entries.length} matching records. Resolve duplicates in D365FO.`;
          line.AddError('Invoice', duplicateMessage);
          continue;
        }

        if (!atLeastOnePosted) {
          line.AddError(
            'Invoice',
            `(${line.Invoice}) exists in D365FO but is not posted (IsPosted=No)`,
          );
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
    return data.map((d) => new CashEntryRawDataModel(d, kind));
  }

  protected getJournalName(): string {
    if (this.isInbound()) {
      return this.isTrucking() ? 'Cust-Pay' : 'Cust-Pay';
    }
    return this.isTrucking() ? 'P-Fleet' : 'P-Freight';
  }

  protected getCollectionDescriptionLabel(): string {
    return this.isTrucking() ? 'Fleet' : 'Freight';
  }

  protected filterLines(sortedLines: CashEntryRawDataModel[]): {
    custodySettlementLines: CashEntryRawDataModel[];
    otherLines: CashEntryRawDataModel[];
    vendorPayment: CashEntryRawDataModel[];
  } {
    const custodySettlementLines: CashEntryRawDataModel[] = [];
    const vendorPayment: CashEntryRawDataModel[] = [];
    const otherLines: CashEntryRawDataModel[] = [];

    for (const line of sortedLines) {
      if (line.IsCustodySettlement) {
        custodySettlementLines.push(line);
      } else if (!this.isInbound() && line.IsVendorPayment) {
        vendorPayment.push(line);
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

  protected buildInvoiceLines(
    invoiceMap: RawDataInvoiceMap,
  ): CashEntryDynDataModel[] {
    const dfoLines: CashEntryDynDataModel[] = [];

    for (const [sourceId, lines] of invoiceMap.entries()) {
      dfoLines.push(...this.buildLines(sourceId, lines));
    }

    return dfoLines;
  }

  protected buildLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
  ): CashEntryDynDataModel[] {
    const invoiceLines: CashEntryDynDataModel[] = [];
    const invoiceLineCount = lines.length;

    switch (invoiceLineCount) {
      case 2:
        invoiceLines.push(...this.caseTwoLines(sourceId, lines));
        break;
      default:
        invoiceLines.push(...this.caseMoreThanTwoLines(sourceId, lines));
    }

    return invoiceLines;
  }

  protected caseTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
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

    return [this.buildLine(sourceId, accountLine, offsetLine)];
  }

  protected caseMoreThanTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
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
          this.buildLine(sourceId, accLine, offsetLines[0], 'ACCOUNT'),
        );
      }

      if (accountLinesLength === 1 && offsetLinesLength > 1) {
        const withoutSettlementOffsetLines = this.filterOutSettlementLines(
          offsetLines,
          settlementSink,
        );

        return withoutSettlementOffsetLines.map((offLine) =>
          this.buildLine(sourceId, accountLines[0], offLine, 'OFFSET'),
        );
      }

      return [this.buildLine(sourceId)];
    } else {
      accountLines = lines.filter((l) => l.DEBITAMOUNT > 0);
      offsetLines = lines.filter((l) => l.CREDITAMOUNT > 0);

      const accountLinesLength = accountLines.length;
      const offsetLinesLength = offsetLines.length;
      const settlementSink: CashEntryRawDataModel[] = [];

      if (accountLinesLength > 1 && offsetLinesLength === 1) {
        return accountLines.map((accLine) =>
          this.buildLine(sourceId, accLine, offsetLines[0], 'ACCOUNT'),
        );
      }

      if (accountLinesLength === 1 && offsetLinesLength > 1) {
        const withoutSettlementOffsetLines = this.filterOutSettlementLines(
          offsetLines,
          settlementSink,
        );

        return withoutSettlementOffsetLines.map((offLine) =>
          this.buildLine(sourceId, accountLines[0], offLine, 'OFFSET'),
        );
      }

      return [this.buildLine(sourceId)];
    }
  }

  protected buildLine(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
  ): CashEntryDynDataModel {
    return this.isInbound()
      ? this.buildLineInbound(
          sourceId,
          accountLine,
          offsetLine,
          amountSource ?? 'OFFSET',
        )
      : this.buildLineOutbound(
          sourceId,
          accountLine,
          offsetLine,
          amountSource ?? 'OFFSET',
        );
  }

  protected buildLineInbound(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
  ): CashEntryDynDataModel {
    const dimensionString =
      offsetLine?.ACCOUNTTYPE === 'Ledger'
        ? offsetLine?.ACCOUNTDISPLAYVALUE
        : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;

    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    const dimensions = this.utilsService.parseDimensionString(dimensionString);

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

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = this.getCollectionDescriptionLabel();
    const description = `Customer Collection - ${label} ${formattedDate} (${accountLine.VoucherType})`;

    const paymentReference = isNotesReceivable
      ? offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`
      : offsetLine.DESCRIPTION || '';

    const dimensionStr = this.utilsService.toDimensionString(dimensions);

    const currencyCode =
      amountSource === 'ACCOUNT'
        ? accountLine.CURRENCYCODE
        : offsetLine.CURRENCYCODE;

    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      offsetLine.TRANSDATE || accountLine.TRANSDATE,
      currencyCode,
    );

    const markedInvoice = this.formatInvoiceInbound(
      accountLine.INVOICE || offsetLine.INVOICE,
    );

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      TransactionText: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: isNotesReceivable ? 'Bank' : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: this.getMethodOfPayment(dimensions.mainAccount),
      PaymentReference: paymentReference,
      JournalName: this.getJournalName(),
      TransactionDate: accountLine.TRANSDATE,
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: dimensionStr,
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
      PostingProfile: 'Cust-PP',
      MarkedInvoice: markedInvoice,
      dataAreaId: this.company,
      SecondaryExchangeRate:
        amountSource === 'ACCOUNT'
          ? accountLine.EXCHANGERATESECONDARY
          : offsetLine.EXCHANGERATESECONDARY,
      Document: accountLine.DOCUMENT,
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

    return dynLine;
  }

  protected buildLineOutbound(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
    amountSource?: 'ACCOUNT' | 'OFFSET',
  ): CashEntryDynDataModel {
    const dimensionString =
      offsetLine?.ACCOUNTTYPE === 'Ledger'
        ? offsetLine?.ACCOUNTDISPLAYVALUE
        : accountLine?.ACCOUNTTYPE === 'Ledger'
          ? accountLine?.ACCOUNTDISPLAYVALUE
          : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;

    const segmentLength =
      this.utilsService.getDimensionSegmentLength(dimensionString);

    const dimensions = this.utilsService.parseDimensionString(dimensionString);

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

    const formattedDate = this.utilsService.formatMonthYear(
      accountLine.TRANSDATE,
    );
    const label = this.getCollectionDescriptionLabel();
    const description = `Vendor Payment - ${label} ${formattedDate} (${accountLine.VoucherType})`;

    const paymentReference =
      offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`;

    const dimensionStr = this.utilsService.toDimensionString(dimensions);

    const currencyCode =
      amountSource === 'ACCOUNT'
        ? accountLine.CURRENCYCODE
        : offsetLine.CURRENCYCODE;

    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      offsetLine.TRANSDATE || accountLine.TRANSDATE,
      currencyCode,
    );

    const dynLine = new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: isNotesReceivable ? 'Bank' : offsetLine.ACCOUNTTYPE,
      PaymentMethodName: this.getMethodOfPayment(dimensions.mainAccount),
      PaymentReference: paymentReference,
      // Custom API requires OFFSETTRANSACTIONTEXT.
      // For non-notes-receivable cash-out we still use the offset line description.
      OffsetTransactionText: isNotesReceivable
        ? paymentReference
        : offsetLine.DESCRIPTION || '',
      JournalName: this.getJournalName(),
      TransDate: accountLine.TRANSDATE,
      TransactionDate: accountLine.TRANSDATE,
      VoucherType: accountLine.VoucherType,
      // Cash-Out: AccountNum must be the vendor account, while OffsetAccountDisplayValue keeps the ledger/bank-side dimensions.
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: dimensionStr,
      FinTagDisplayValue: accountLine.FINTAGDISPLAYVALUE,
      OffsetFinTagDisplayValue: offsetLine.FINTAGDISPLAYVALUE,
      CreditAmount: 0,
      DebitAmount:
        amountSource === 'ACCOUNT'
          ? accountLine.DEBITAMOUNT
          : offsetLine.CREDITAMOUNT,
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      DefaultDimensionDisplayValue: dimensionStr,
      OffsetDefaultDimensionDisplayValue: dimensionStr,
      SalesTaxGroup: offsetLine.SALESTAXGROUP,
      ItemSalesTaxGroup: offsetLine.ITEMSALESTAXGROUP,
      ItemWithholdingTaxGroupCode: offsetLine.ITEMWITHHOLDINGTAXGROUPCODE,
      OffsetCompany: this.company,
      PostingProfile: 'V-PP',
      Invoice: accountLine.INVOICE || offsetLine.INVOICE,
      MarkedInvoice: accountLine.INVOICE || offsetLine.INVOICE,
      dataAreaId: this.company,
      ExchRateSecond: offsetLine.EXCHANGERATESECONDARY,
      Document: accountLine.DOCUMENT,
      DueDate: accountLine.DUEDATE,
      PaymentId: sourceId,
      SafeType: accountLine.SafeType,
    });

    if (!this.utilsService.isValidDimensionSegmentLength(segmentLength)) {
      dynLine.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${segmentLength}. Expected 19 or 20 segments.`,
      );
    }

    return dynLine;
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
    const accountType = line.ACCOUNTTYPE;
    const mainAccount = dimensions.mainAccount;

    if (accountType !== 'Ledger') return false;

    if (!mainAccount) return false;

    return this.SETTLEMENT_MAIN_ACCOUNTS.includes(mainAccount);
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

  protected getMethodOfPayment(mainAccount?: string): string {
    if (!mainAccount) return '';

    return (
      {
        '122201': 'NR – EGP',
        '122202': 'NR – USD',
        '122203': 'NR – EUR',
        '122204': 'NR – GBP',
        '123510': 'NR – GBP',
      }[mainAccount] || ''
    );
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
}
