import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashEntryDynDataModel } from '@/modules/cash/cash-in/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/cash-in/models/cash-entry-raw-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/models/entry-processor.model';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';

type RawDataInvoiceMap = Map<string, CashEntryRawDataModel[]>;

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly logger = new Logger(CashInFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;
  private readonly NOTES_RECEIVABLE_MAIN_ACCOUNTS = [
    '122201',
    '122202',
    '122203',
    '122204',
    '123510',
  ];
  private readonly SETTLEMENT_MAIN_ACCOUNTS = ['421103'];
  private readonly JOURNAL_NAME = 'Cust-Pay';

  private _tempSet = new Set<string>();

  private settlementLines: CashEntryRawDataModel[] = [];

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    Customer: true,
    SubCustomer: false,
    ChargeType: true,
    SalesMan: true,
    CoordinatorMan: true,
    FreightType: true,
    Direction: true,
  };

  constructor(
    private readonly commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super({ dependencies: baseDeps });
  }

  // --------------------------------------------------------------------------
  // FORMAT & ENRICH
  // --------------------------------------------------------------------------

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    this.company = company;

    await this.warmupProcessorData({ customerNames: true });

    const rawCount = data.length;
    this.logger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Map & sort
    this.logger.debug(`[STEP 1] Mapping ${rawCount} raw records to models`);
    const rawLines = this.mapToModel(data);
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    // STEP 1.5: Sort lines by line number
    this.logger.debug(
      `[STEP 1.5] Sorting ${rawLines.length} lines by line number`,
    );
    const sortedLines = this.sortRawDataByLineNumber(rawLines);
    this.logger.debug(`[STEP 1.5] Sorted to ${sortedLines.length} lines`);

    // STEP 2: FILTER CUSTODY SETTLEMENTS
    this.logger.debug(
      `[STEP 2] Filtering custody settlements from ${sortedLines.length} lines`,
    );
    const { custodySettlementLines, otherLines } =
      this.filterLines(sortedLines);
    this.logger.debug(
      `[FILTER] Processed ${sortedLines.length} lines → ${custodySettlementLines.length} custody settlement, ${otherLines.length} customer collection, down payment and other lines`,
    );

    // STEP 2.5: run custody settlement with raw data (no file – already extracted from Excel)
    this.logger.debug(
      `[STEP 2.5] Processing ${custodySettlementLines.length} custody settlement lines`,
    );
    this.processCustodySettlementLines(custodySettlementLines);

    // STEP 3: Build invoice map
    this.logger.debug(
      `[STEP 3] Building invoice map from ${otherLines.length} lines`,
    );
    const invoiceMap = this.buildUniqueIdMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.logger.debug(`[STEP 3] Grouped into ${invoiceCount} invoices`);

    // STEP 3.5: Check invoice balanced after FX
    this.logger.debug(
      `[STEP 3.5] Checking invoice balanced after FX for ${invoiceCount} invoices`,
    );
    this.checkInvoiceBalancedAfterFx(invoiceMap);
    this.logger.debug(`[STEP 3.5] Checked invoice balanced after FX`);

    if (this.unbalancedUniqueIds.size > 0) {
      this.logger.error(
        `[STEP 3.5] Found ${this.unbalancedUniqueIds.size} unbalanced invoices after FX`,
      );
    } else {
      this.logger.debug(`[STEP 3.5] All invoices are balanced after FX`);
    }

    // STEP 4: Build DFO lines
    this.logger.debug(
      `[STEP 4] Building DFO lines from ${invoiceCount} invoices`,
    );
    const dfoLines = this.buildInvoiceLines(invoiceMap);
    this.logger.debug(`[STEP 4] Built ${dfoLines.length} DFO lines`);

    // STEP 5: Update batch and voucher numbers
    this.logger.debug(
      `[STEP 5] Updating batch and voucher numbers for ${dfoLines.length} lines`,
    );
    const updatedDfoLines = this.utilsService.updateBatchAndVoucher({
      lines: dfoLines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
      maxLinesPerBatch: this.MAX_LINES_PER_BATCH,
    });
    this.logger.debug(
      `[STEP 5] Updated batch and voucher numbers for ${updatedDfoLines.length} lines`,
    );

    return updatedDfoLines.map(
      (line) => new CashEntryDynDataModel(line.DimensionModel, line),
    );
  }

  public validateAsync(data: DynDataModel[]): DynDataModel[] {
    const lines = data as unknown as CashEntryDynDataModel[];
    const lineCount = lines.length;
    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      if (this.unbalancedUniqueIds.has(line.SourceIds[0])) {
        line.AddError('UnbalancedInvoice', 'Invoice is unbalanced after FX');
      }
      this.validateDimensionsForLine(line);
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapToModel(data: RawDataModel[]): CashEntryRawDataModel[] {
    return data.map((d) => new CashEntryRawDataModel(d, 'Freight'));
  }

  private filterLines(sortedLines: CashEntryRawDataModel[]) {
    const custodySettlementLines: CashEntryRawDataModel[] = [];
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
    };
  }

  private processCustodySettlementLines(lines: CashEntryRawDataModel[]): void {
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

  private buildInvoiceLines(
    invoiceMap: RawDataInvoiceMap,
  ): CashEntryDynDataModel[] {
    const dfoLines: CashEntryDynDataModel[] = [];

    for (const [sourceId, lines] of invoiceMap.entries()) {
      dfoLines.push(...this.buildLines(sourceId, lines));
    }

    return dfoLines;
  }

  private buildLines(
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

  private caseTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
  ): CashEntryDynDataModel[] {
    const accountLine = lines.find((l) => l.IsCustomer);
    const offsetLine = lines.find((l) => !l.IsCustomer);

    return [this.buildLine(sourceId, accountLine, offsetLine)];
  }

  private caseMoreThanTwoLines(
    sourceId: string,
    lines: CashEntryRawDataModel[],
  ): CashEntryDynDataModel[] {
    const withoutSettlement = this.filterOutSettlementLines(lines);

    const accountLines = withoutSettlement.filter((l) => l.IsCustomer);
    const offsetLines = withoutSettlement.filter((l) => !l.IsCustomer);

    if (offsetLines.length > 1) {
      for (const line of offsetLines) {
        this._tempSet.add(line.UniqueId.toString());
      }
    }

    return offsetLines
      .map((offLine) => {
        return accountLines.map((accLine) => {
          accLine.CREDITAMOUNT = offLine.DEBITAMOUNT;
          return this.buildLine(sourceId, accLine, offLine);
        });
      })
      .flat();
  }

  private buildLine(
    sourceId: string,
    accountLine?: CashEntryRawDataModel,
    offsetLine?: CashEntryRawDataModel,
  ): CashEntryDynDataModel {
    const dimensions = this.utilsService.parseDimensionString(
      offsetLine?.ACCOUNTTYPE === 'Ledger'
        ? offsetLine?.ACCOUNTDISPLAYVALUE
        : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE,
    );

    if (!accountLine || !offsetLine) {
      const line = new CashEntryDynDataModel(dimensions, {
        SourceIds: [sourceId],
      });
      line.AddError('InvalidInvoice', 'No Cust or offset line found');
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
    const description = `Customer Collection - Freight ${formattedDate} (${accountLine.VoucherType})`;
    const paymentReference = isNotesReceivable
      ? offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - Freight`
      : '';

    const dimensionStr = this.utilsService.toDimensionString(dimensions);

    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      offsetLine.TRANSDATE,
      offsetLine.CURRENCYCODE,
    );

    const markedInvoice = this.formatInvoice(
      accountLine.INVOICE || offsetLine.INVOICE,
    );

    return new CashEntryDynDataModel(dimensions, {
      SourceIds: [sourceId],
      Description: description,
      Company: this.company,
      AccountType: accountLine.ACCOUNTTYPE,
      OffsetAccountType: isNotesReceivable ? 'Bank' : offsetLine.ACCOUNTTYPE,
      PaymentMethod: this.getMethodOfPayment(dimensions.mainAccount),
      PaymentReference: paymentReference,
      JournalName: this.JOURNAL_NAME,
      TransactionDate: accountLine.TRANSDATE,
      AccountDisplayValue: dimensionStr,
      OffsetAccountDisplayValue: dimensionStr,
      FinTagDisplayValue: accountLine.FINTAGDISPLAYVALUE,
      OffsetFinTagDisplayValue: offsetLine.FINTAGDISPLAYVALUE,
      CreditAmount: accountLine.CREDITAMOUNT,
      DebitAmount: offsetLine.DEBITAMOUNT,
      CurrencyCode: offsetLine.CURRENCYCODE,
      ExchangeRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      IsPrepayment: accountLine.PREPAYMENT,
      CustomerName: this.getCustomerName(accountLine.ACCOUNTDISPLAYVALUE),
      DefaultDimensionsForAccountDisplayValue:
        accountLine.DEFAULTDIMENSIONDISPLAYVALUE,
      DefaultDimensionsForOffsetAccountDisplayValue:
        offsetLine.DEFAULTDIMENSIONDISPLAYVALUE,
      SalesTaxGroup: offsetLine.SALESTAXGROUP,
      OffsetCompany: this.company,
      PostingProfile: 'Cust-PP',
      MarkedInvoice: markedInvoice,
      MarkedInvoiceCompany: this.company,
      VoucherType: accountLine.VOUCHERTYPE,
      OffsetVoucherType: offsetLine.VOUCHERTYPE,
    });
  }

  private isNotesReceivableLine(
    line: CashEntryRawDataModel,
    dimensions: AccountDimensionsModel,
  ): boolean {
    const accountType = line.ACCOUNTTYPE;
    const mainAccount = dimensions.mainAccount;

    if (accountType !== 'Ledger') return false;

    if (!mainAccount) return false;

    return this.NOTES_RECEIVABLE_MAIN_ACCOUNTS.includes(mainAccount);
  }

  private isSettlementLine(
    line: CashEntryRawDataModel,
    dimensions: AccountDimensionsModel,
  ): boolean {
    const accountType = line.ACCOUNTTYPE;
    const mainAccount = dimensions.mainAccount;

    if (accountType !== 'Ledger') return false;

    if (!mainAccount) return false;

    return this.SETTLEMENT_MAIN_ACCOUNTS.includes(mainAccount);
  }

  private filterOutSettlementLines(
    lines: CashEntryRawDataModel[],
  ): CashEntryRawDataModel[] {
    const withoutSettlement: CashEntryRawDataModel[] = [];
    for (const line of lines) {
      const dimensions = this.utilsService.parseDimensionString(
        line.ACCOUNTDISPLAYVALUE,
      );
      if (this.isSettlementLine(line, dimensions)) {
        this.settlementLines.push(line);
      } else {
        withoutSettlement.push(line);
      }
    }

    return withoutSettlement;
  }

  private getMethodOfPayment(mainAccount?: string): string {
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

  private formatInvoice(invoice?: string): string {
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

    return `${number.toString().padStart(9, '0')}/${textPart}`;
  }
}
