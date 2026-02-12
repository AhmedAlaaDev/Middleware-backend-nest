import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashInFreightDFOLine } from '@/modules/cash-in/interfaces/cash-in-freight-dfo-data.interface';
import { CashInFreightRawData } from '@/modules/cash-in/models/cash-in-freight-raw-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import {
  DimensionKey,
  RequiredDimensionsConfig,
} from '@/modules/entry-processor/types/dimension-key.type';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetCustomersQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

type RawDataInvoiceMap = Map<string, CashInFreightRawData[]>;

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly logger = new Logger(CashInFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

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
    const rawCount = data.length;
    this.logger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Map & sort
    this.logger.debug(`[STEP 1] Mapping ${rawCount} raw records to models`);
    const rawLines = this.mapToModels(data);
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    // STEP 2: FILTER CUSTODY SETTLEMENTS
    this.logger.debug(
      `[STEP 2] Filtering custody settlements from ${rawLines.length} lines`,
    );
    const { custodySettlementLines, otherLines } =
      this.filteredSortedLines(rawLines);
    this.logger.debug(
      `[FILTER] Processed ${rawLines.length} lines → ${custodySettlementLines.length} custody settlement, ${otherLines.length} other lines`,
    );

    // STEP 2.5: run custody settlement with raw data (no file – already extracted from Excel)
    if (custodySettlementLines.length > 0) {
      this.commandBus
        .execute(
          new ProcessCustodySettlementEntryCommand(
            company,
            undefined,
            custodySettlementLines,
          ),
        )
        .catch((error) => {
          this.logger.error(
            `Error processing custody settlement entry: ${error}`,
          );
        });
    }

    // STEP 3: Build invoice map
    this.logger.debug(
      `[STEP 3] Building invoice map from ${otherLines.length} lines`,
    );
    const invoiceMap = this.buildInvoiceMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.logger.debug(`[STEP 3] Grouped into ${invoiceCount} invoices`);

    // STEP 4: Build DFO lines
    this.logger.debug(
      `[STEP 4] Building DFO lines from ${invoiceCount} invoices`,
    );
    const dfoLines = await this.buildLines(invoiceMap, company);
    this.logger.debug(`[STEP 4] Built ${dfoLines.length} DFO lines`);

    // STEP 5: Batch processing (rules)
    // - MAX 1000 lines per batch
    // - batch contains only invoices from the same month
    // - invoice cannot be split across batches
    this.logger.debug(`[STEP 5] Initializing batch processing`);
    const journalBatchNum = await this.getNextBatchNumber();
    const voucherNum = await this.getNextVoucherNumber();
    this.logger.debug(
      `[STEP 5] Starting with batch number: ${journalBatchNum}, voucher number: ${voucherNum}`,
    );
    const updatedDfoLines = this.updateBatchAndVoucher(
      dfoLines,
      journalBatchNum,
      voucherNum,
    );
    this.logger.debug(
      `[COMPLETE] Generated ${updatedDfoLines.length} enriched lines`,
    );

    return updatedDfoLines;
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as CashInFreightDFOLine[];
    const lineCount = lines.length;
    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      await this.validateDimensionsForLine(line, {
        validateMainAccount:
          line.AccountType?.trim()?.toLowerCase() === 'ledger',
      });
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapToModels(data: RawDataModel[]): CashInFreightRawData[] {
    return data.map((d) => new CashInFreightRawData(d));
  }

  private sortLinesByLineNumber(
    lines: CashInFreightRawData[],
  ): CashInFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private filteredSortedLines(sortedLines: CashInFreightRawData[]) {
    const custodySettlementLines: CashInFreightRawData[] = [];
    const otherLines: CashInFreightRawData[] = [];

    for (const line of sortedLines) {
      if (line.ISCUSTODYSETTLEMENT) {
        custodySettlementLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    return {
      custodySettlementLines: this.sortLinesByLineNumber(
        custodySettlementLines,
      ),
      otherLines: this.sortLinesByLineNumber(otherLines),
    };
  }

  private updateBatchAndVoucher(
    dfoLines: CashInFreightDFOLine[],
    journalBatchNum: number,
    voucherNum: number,
  ): CashInFreightDFOLine[] {
    const invoiceMap = new Map<string, CashInFreightDFOLine[]>();
    for (const line of dfoLines) {
      const uniqueId = String(line.PaymentId);
      if (!invoiceMap.has(uniqueId)) {
        invoiceMap.set(uniqueId, []);
      }
      invoiceMap.get(uniqueId)!.push(line);
    }

    const updatedMap = new Map<string, CashInFreightDFOLine[]>();

    let currentBatchMonth: string | null = null;
    let currentBatchLineCount = 0;
    let currentBatchNumber = journalBatchNum;
    let currentVoucherNum = voucherNum;

    let lineNumberInBatch = 1;

    for (const [uniqueId, lines] of invoiceMap.entries()) {
      if (!lines || lines.length === 0) {
        continue;
      }

      const headerLine = lines[0];
      const invoiceMonth = this.utilsService.toMonthKey(
        headerLine.TransactionDate,
      );

      const invoiceLineCount = lines.length;
      const monthChanged = currentBatchMonth !== invoiceMonth;
      const wouldExceedLimit =
        currentBatchLineCount + invoiceLineCount > this.MAX_LINES_PER_BATCH;

      // If month changes, or adding this invoice would exceed the max lines,
      // we start a new batch and reset line number.
      if (monthChanged || wouldExceedLimit) {
        if (currentBatchMonth !== null) {
          currentBatchNumber++;
        }
        currentBatchMonth = invoiceMonth;
        currentBatchLineCount = 0;
        lineNumberInBatch = 1;
      }

      // Edge case: a single invoice exceeds the batch limit.
      // We keep it intact (do not split invoice), even if it exceeds 1000.
      if (invoiceLineCount > this.MAX_LINES_PER_BATCH) {
        this.logger.warn(
          `Invoice ${headerLine.MarkedInvoice ?? headerLine.PaymentId} has ${invoiceLineCount} lines (> ${this.MAX_LINES_PER_BATCH}). Keeping it in a single batch.`,
        );
      }

      const journalName = headerLine.JournalName;
      const formattedBatch =
        this.utilsService.formatBatchNumber(currentBatchNumber);
      const formattedVoucher = this.utilsService.formatVoucherNumber(
        currentVoucherNum,
        journalName,
      );

      const updatedLines: CashInFreightDFOLine[] = [];

      for (const line of lines) {
        const updatedLine = new CashInFreightDFOLine(
          {
            ...line,
            JournalBatchNumber: formattedBatch,
            Voucher: formattedVoucher,
            LineNumber: lineNumberInBatch,
          },
          line.DimensionModel,
        );

        updatedLines.push(updatedLine);
        currentBatchLineCount++;
        lineNumberInBatch++;
      }

      // Move to next voucher for the next invoice
      currentVoucherNum++;

      updatedMap.set(uniqueId, updatedLines);
    }

    return Array.from(updatedMap.values()).flat();
  }

  private buildInvoiceMap(
    sortedLines: CashInFreightRawData[],
  ): RawDataInvoiceMap {
    const invoiceMap: RawDataInvoiceMap = new Map();

    for (const line of sortedLines) {
      const uniqueId = String(line.UniqueId);
      if (!invoiceMap.has(uniqueId)) {
        invoiceMap.set(uniqueId, []);
      }
      invoiceMap.get(uniqueId)!.push(line);
    }

    return invoiceMap;
  }

  private static readonly AMOUNT_EPSILON = 1e-6;

  private async buildLines(
    invoiceMap: RawDataInvoiceMap,
    company: string,
  ): Promise<CashInFreightDFOLine[]> {
    const allLines = Array.from(invoiceMap.values()).flat();
    const uniqueCustomerAccounts = new Set<string>();
    for (const line of allLines) {
      if (
        line.ACCOUNTTYPE?.toLowerCase() === 'cust' &&
        line.ACCOUNTDISPLAYVALUE
      ) {
        uniqueCustomerAccounts.add(line.ACCOUNTDISPLAYVALUE);
      }
    }

    const customerNameEntries = await Promise.all(
      Array.from(uniqueCustomerAccounts).map(async (accountDisplayValue) => {
        const name = await this.getCustomerName(
          'cust',
          accountDisplayValue,
          company,
        );
        return [accountDisplayValue, name] as const;
      }),
    ).then((entries) => new Map(entries));

    const dfoLines: CashInFreightDFOLine[] = [];

    for (const [uniqueId, lines] of invoiceMap.entries()) {
      const debitLine = lines.find((l) => l.ISDEBIT);
      const creditLines = lines.filter((l) => l.ISCREDIT);

      if (!debitLine) {
        const built = await Promise.all(
          creditLines.map((creditLine) =>
            this.buildLine(
              null,
              creditLine,
              company,
              false,
              customerNameEntries,
            ),
          ),
        );
        for (let i = 0; i < built.length; i++) {
          built[i].AddError(
            'Invoice',
            `Invoice ${creditLines[i].INVOICE ?? uniqueId} has no debit line.`,
          );
          dfoLines.push(built[i]);
        }
        if (creditLines.length === 0) {
          const placeholder = lines[0];
          if (placeholder) {
            const dfoLine = await this.buildLine(
              placeholder,
              placeholder,
              company,
              true,
              customerNameEntries,
            );
            dfoLine.AddError(
              'Invoice',
              `Invoice ${placeholder.INVOICE ?? uniqueId} has no debit and no credit lines.`,
            );
            dfoLines.push(dfoLine);
          }
        }
        continue;
      }

      if (creditLines.length === 0) {
        const dfoLine = await this.buildLine(
          debitLine,
          debitLine,
          company,
          true,
          customerNameEntries,
        );
        dfoLine.AddError(
          'Invoice',
          `Invoice ${debitLine.INVOICE ?? uniqueId} has no credit lines.`,
        );
        dfoLines.push(dfoLine);
        continue;
      }

      const totalDebit = debitLine.DEBITAMOUNT;
      const totalCredit = creditLines.reduce(
        (sum, c) => sum + c.CREDITAMOUNT,
        0,
      );
      const amountsMatch =
        Math.abs(totalDebit - totalCredit) <
        CashInFreightEntryProcessor.AMOUNT_EPSILON;
      const balanceError = !amountsMatch
        ? `Total credit (${totalCredit}) does not match debit (${totalDebit}) for invoice ${debitLine.INVOICE ?? uniqueId}.`
        : null;

      const built = await Promise.all(
        creditLines.map((creditLine) =>
          this.buildLine(
            debitLine,
            creditLine,
            company,
            false,
            customerNameEntries,
          ),
        ),
      );
      for (const dfoLine of built) {
        if (balanceError) {
          dfoLine.AddError('Invoice', balanceError);
        }
        dfoLines.push(dfoLine);
      }
    }
    return dfoLines;
  }

  private async buildLine(
    debitLine: CashInFreightRawData | null,
    creditLine: CashInFreightRawData,
    company: string,
    useDebitAmounts = false,
    customerNameMap?: Map<string, string>,
  ): Promise<CashInFreightDFOLine> {
    const isLedger = creditLine.ISLEDGER || debitLine?.ISLEDGER;
    const dimensionModel = isLedger
      ? this.utilsService.parseDimensionString(creditLine.ACCOUNTDISPLAYVALUE)
      : this.utilsService.parseDimensionString(
          creditLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
        );

    const lineAmount = useDebitAmounts
      ? creditLine.DEBITAMOUNT
      : creditLine.CREDITAMOUNT;

    const customerName =
      customerNameMap && creditLine.ACCOUNTTYPE?.toLowerCase() === 'cust'
        ? (customerNameMap.get(creditLine.ACCOUNTDISPLAYVALUE) ?? '')
        : customerNameMap === undefined
          ? await this.getCustomerName(
              creditLine.ACCOUNTTYPE,
              creditLine.ACCOUNTDISPLAYVALUE,
              company,
            )
          : '';

    const { exchangeRate, reportingRate } = await this.fetchExchangeRates(
      creditLine.TRANSDATE,
      creditLine.CURRENCYCODE || '',
    );

    const line = new CashInFreightDFOLine(
      {
        JournalBatchNumber: '',
        LineNumber: 0,
        AccountDisplayValue: creditLine.ACCOUNTDISPLAYVALUE,
        OffsetAccountDisplayValue: debitLine?.ACCOUNTDISPLAYVALUE ?? '',
        AccountType: creditLine.ACCOUNTTYPE,
        OffsetAccountType: debitLine?.ACCOUNTTYPE ?? '',
        DefaultDimensionsForAccountDisplayValue:
          creditLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
        DefaultDimensionsForOffsetAccountDisplayValue:
          debitLine?.DEFAULTDIMENSIONDISPLAYVALUE ?? '',
        Company: company,
        CurrencyCode: creditLine.CURRENCYCODE || '',
        CreditAmount: lineAmount,
        DebitAmount: lineAmount,
        ExchangeRate: exchangeRate,
        TransactionDate: creditLine.TRANSDATE,
        TransactionText: creditLine.TEXT || '',
        PostingProfile: creditLine.POSTINGPROFILE || '',
        MarkedInvoice: creditLine.INVOICE || '',
        CalculateWithholdingTax: creditLine.ISWITHHOLDINGCALCULATIONENABLED
          ? 'Yes'
          : 'No',
        CustomerName: customerName,
        FinTagDisplayValue: creditLine.FINTAGDISPLAYVALUE || '',
        OffsetFinTagDisplayValue: debitLine?.FINTAGDISPLAYVALUE ?? '',
        OffsetTransactionText: debitLine?.TEXT ?? '',
        IsPrepayment: creditLine.ISPREPAYMENT ? 'Yes' : 'No',
        MarkedInvoiceCompany: company,
        OffsetCompany: company,
        ReportingCurrencyExchRate: reportingRate,
        ReportingCurrencyExchRateSecondary:
          creditLine.REPORTINGCURRENCYEXCHRATESECONDARY || 0,
        SecondaryExchangeRate: creditLine.EXCHANGERATESECONDARY || '',
        TaxGroup: creditLine.SALESTAXGROUP || '',
        TransactionDateD365: creditLine.TRANSDATE,
        Voucher: '',
        PaymentId: creditLine.UniqueId.toString(),
        JournalName: creditLine.JOURNALNAME,
      },
      dimensionModel,
    );
    return Promise.resolve(line);
  }

  private async getCustomerName(
    accountType: string,
    accountDisplayValue: string,
    company: string,
  ): Promise<string> {
    if (accountType.toLowerCase() !== 'cust') return '';

    const customers = await this.queryBus.execute(
      new GetCustomersQuery({
        company: company,
        searchTerm: accountDisplayValue,
      }),
    );

    return customers?.items[0]?.name || '';
  }

  private async getNextBatchNumber(): Promise<number> {
    const value =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.batch.number'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }

  private async getNextVoucherNumber(): Promise<number> {
    const value =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.voucher.cash.in.freight'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }

  private async getDimensionsMap() {
    const dimensionsMap = new Map<string, IFinancialDimensionValue[]>();
    for (const key of Object.keys(this.requiredDimensions) as DimensionKey[]) {
      const dimensionValues =
        await this.dimensionService.getDimensionValues(key);
      dimensionsMap.set(key, dimensionValues || []);
    }
    return dimensionsMap;
  }
}
