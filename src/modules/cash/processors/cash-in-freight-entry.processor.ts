import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { capitalize } from '@/lib/utils';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { ProcessCustodySettlementEntryCommand } from '@/modules/closing/commands/process-custody-settlement-entry.command';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDynDataModel,
  EntryRawDataModel,
  EntryDimensionsModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

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
    SubCustomer: true,
    ChargeType: false,
    SalesMan: false,
    CoordinatorMan: false,
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
    data: EntryRawDataModel[],
    company: string,
  ): Promise<EntryDynDataModel[]> {
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

    // STEP 6: Fetch free text invoices
    this.logger.debug(
      `[STEP 6] Fetching free text invoices for ${updatedDfoLines.length} lines`,
    );
    await this.fetchFreeTextInvoices({
      invoiceNumbers: updatedDfoLines.map((line) => line.Invoice ?? ''),
    });
    this.logger.debug(
      `[STEP 6] Fetched free text invoices ${this.freeTextInvoiceMap?.size} invoices`,
    );

    return updatedDfoLines.map(
      (line) => new CashEntryDynDataModel(line.DimensionModel, line),
    );
  }

  public validateAsync(data: EntryDynDataModel[]): EntryDynDataModel[] {
    const lines = data as unknown as CashEntryDynDataModel[];
    const lineCount = lines.length;
    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      if (this.unbalancedUniqueIds.has(line.SourceIds[0])) {
        line.AddError('UnbalancedInvoice', 'Invoice is unbalanced after FX');
      }

      this.validateDimensionsForLine(line);

      if (this.freeTextInvoiceMap) {
        const invoiceKey = (line.Invoice ?? '').trim().toLowerCase();

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

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapToModel(data: EntryRawDataModel[]): CashEntryRawDataModel[] {
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
      TransDate: accountLine.TRANSDATE,
      AccountDisplayValue: accountLine.ACCOUNTDISPLAYVALUE,
      OffsetAccountDisplayValue: offsetLine.ACCOUNTDISPLAYVALUE,
      FinTagDisplayValue: accountLine.FINTAGDISPLAYVALUE,
      OffsetFinTagDisplayValue:
        offsetLine.ACCOUNTTYPE === 'Ledger'
          ? dimensionStr
          : offsetLine.FINTAGDISPLAYVALUE,
      CreditAmount: accountLine.CREDITAMOUNT,
      DebitAmount: offsetLine.DEBITAMOUNT,
      CurrencyCode: offsetLine.CURRENCYCODE,
      ExchRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      CustomerName: this.getCustomerName(accountLine.ACCOUNTDISPLAYVALUE),
      DefaultDimensionDisplayValue: accountLine.DEFAULTDIMENSIONDISPLAYVALUE,
      OffsetDefaultDimensionDisplayValue:
        offsetLine.DEFAULTDIMENSIONDISPLAYVALUE,
      SalesTaxGroup: offsetLine.SALESTAXGROUP,
      OffsetCompany: this.company,
      PostingProfile: 'Cust-PP',
      Invoice: markedInvoice,
      dataAreaId: this.company,
      ExchRateSecond: offsetLine.EXCHANGERATESECONDARY,
      Document: accountLine.DOCUMENT,
      DueDate: accountLine.DUEDATE,
    });
  }

  private isNotesReceivableLine(
    line: CashEntryRawDataModel,
    dimensions: EntryDimensionsModel,
  ): boolean {
    const accountType = line.ACCOUNTTYPE;
    const mainAccount = dimensions.mainAccount;

    if (accountType !== 'Ledger') return false;

    if (!mainAccount) return false;

    return this.NOTES_RECEIVABLE_MAIN_ACCOUNTS.includes(mainAccount);
  }

  private isSettlementLine(
    line: CashEntryRawDataModel,
    dimensions: EntryDimensionsModel,
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
    const textParts = parts[1]
      ?.trim()
      ?.toLowerCase()
      ?.split(' ')
      ?.filter(Boolean);

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

    if (textParts.includes('نولون')) {
      newTextPart = 'OF-FW';
    }

    if (textParts.includes('import') && textParts.includes('store')) {
      newTextPart = 'INVOICE';
    }

    if (textParts.includes('import') && textParts.includes('stor')) {
      newTextPart = 'INVOICE';
    }

    if (textParts.includes('dekheila') && textParts.includes('storage')) {
      newTextPart = 'INVOICE';
    }

    const lowercasedTextPart = newTextPart?.toLowerCase();
    const suffix =
      lowercasedTextPart === 'invoice'
        ? capitalize(newTextPart)
        : newTextPart?.toUpperCase();

    return `${number.toString().padStart(9, '0')}/${suffix}`;
  }
}
