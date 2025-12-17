import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthKey } from '@/lib/utils';
import {
  CashInFreightDFOLine,
  CashInFreightDFOLineBase,
  CashInFreightDFOHeader,
  CashInFreightDFOSettled,
} from '@/modules/cash-in/interfaces/cash-in-freight-dfo-data.interface';
import { CashInFreightRawData } from '@/modules/cash-in/models/cash-in-freight-raw-data.model';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

type MonthVoucherMap = Map<string, Map<string, CashInFreightRawData[]>>;

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(CashInFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
  ] as const;

  constructor(
    customerInvoiceService: CustomerInvoiceService,
    queryBus: QueryBus,
    db: DBService,
  ) {
    super(customerInvoiceService, queryBus, db);
  }

  // --------------------------------------------------------------------------
  // FORMAT & ENRICH
  // --------------------------------------------------------------------------

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    const rawCount = data.length;
    this.procLogger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Map & sort
    const sortedLines = this.sortLinesByLineNumber(this.mapToModels(data));

    // STEP 2: Build month → voucher map
    const monthVoucherMap = this.buildVoucherMap(sortedLines);
    const monthCount = monthVoucherMap.size;
    const voucherCount = Array.from(monthVoucherMap.values()).reduce(
      (sum, voucherMap) => sum + voucherMap.size,
      0,
    );
    this.procLogger.debug(
      `Grouped ${sortedLines.length} lines into ${monthCount} months and ${voucherCount} vouchers`,
    );

    // STEP 3: Batch processing (rules)
    // - MAX 1000 lines per batch
    // - batch contains only one month
    // - voucher cannot be split across batches
    const eData: CashInFreightDFOLine[] = [];

    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();

    let currentBatchLines: CashInFreightDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: CashInFreightDFOHeader | null = null;
    let batchCount = 0;
    let lineNumber = 1;

    for (const [monthKey, voucherMap] of monthVoucherMap.entries()) {
      for (const [voucherKey, voucherLines] of voucherMap.entries()) {
        const headerLine = voucherLines[0];
        const groupLineCount = voucherLines.length;

        if (!headerLine || groupLineCount === 0) {
          continue;
        }

        const monthChanged = currentBatchMonth !== monthKey;
        const wouldExceedLimit =
          currentBatchLines.length + groupLineCount > this.MAX_LINES_PER_BATCH;

        if (monthChanged || wouldExceedLimit || currentHeader === null) {
          // Close previous batch
          if (currentBatchLines.length > 0 && currentHeader) {
            this.flushBatch(currentHeader, currentBatchLines, eData);
            batchCount++;
            journalBatchNum++;
          }

          // Start new batch
          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(headerLine, journalBatchNum);
          currentBatchLines = [];
          lineNumber = 1;
        }

        // Edge case: a single voucher exceeds the batch limit.
        // We keep it intact (do not split voucher), even if it exceeds 1000.
        if (groupLineCount > this.MAX_LINES_PER_BATCH) {
          this.procLogger.warn(
            `Voucher ${voucherKey} has ${groupLineCount} lines (> ${this.MAX_LINES_PER_BATCH}). Keeping it in a single batch.`,
          );
        }

        const voucher = voucherNum++;

        for (const rawLine of voucherLines) {
          const enrichedLine = this.buildLine({
            rawLine,
            header: currentHeader,
            company,
            voucher,
            lineNumber,
          });

          currentBatchLines.push(enrichedLine);
          lineNumber++;
        }
      }
    }

    // Final flush
    if (currentBatchLines.length > 0 && currentHeader) {
      this.flushBatch(currentHeader, currentBatchLines, eData);
      batchCount++;
    }

    this.procLogger.debug(
      `Final output = ${eData.length} enriched lines across ${batchCount} batches`,
    );

    return eData as unknown as DynDataModel[];
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as CashInFreightDFOLine[];

    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    const dimensionsMap: Record<string, IFinancialDimensionValue[]> = {};
    for (const key of this.requiredDimensions) {
      dimensionsMap[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    for (const line of lines) {
      this.validateMainAccount(line, mainAccounts);
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      this.validateBusinessUnit(line, dimensionsMap.BusinessUnit);
      this.validateLocation(line, dimensionsMap.Location);
      this.validateCustomerDimension(line, dimensionsMap.Customer);
      this.validateSubCustomerDimension(line, dimensionsMap.SubCustomer);
      this.validateChargeTypeDimension(
        line,
        dimensionsMap.ChargeType.map((d) => d.value || '').filter(Boolean),
      );
      this.validateSalesMan(line, dimensionsMap.SalesMan);
      this.validateCoordinatorMan(line, dimensionsMap.CoordinatorMan);
      this.validateFreightType(line, dimensionsMap.FreightType);
      this.validateDirection(line, dimensionsMap.Direction);
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

  private buildVoucherMap(
    sortedLines: CashInFreightRawData[],
  ): MonthVoucherMap {
    const monthVoucherMap: MonthVoucherMap = new Map();

    for (const line of sortedLines) {
      const monthKey = this.safeMonthKey(line);
      const voucherKey = this.safeVoucherKey(line);

      if (!monthVoucherMap.has(monthKey)) {
        monthVoucherMap.set(monthKey, new Map());
      }

      const voucherMap = monthVoucherMap.get(monthKey)!;
      if (!voucherMap.has(voucherKey)) {
        voucherMap.set(voucherKey, []);
      }

      voucherMap.get(voucherKey)!.push(line);
    }

    return monthVoucherMap;
  }

  private safeMonthKey(line: CashInFreightRawData): string {
    try {
      return getMonthKey(line.TRANSDATE);
    } catch {
      return 'invalid-date';
    }
  }

  private safeVoucherKey(line: CashInFreightRawData): string {
    const v = String(line.VOUCHER || '').trim();
    return v || `uid-${String(line.UniqueId)}`;
  }

  private startNewBatch(
    headerLine: CashInFreightRawData,
    journalBatchNum: number,
  ): CashInFreightDFOHeader {
    return this.createBatchHeader(headerLine, journalBatchNum);
  }

  private flushBatch(
    _header: CashInFreightDFOHeader,
    batchLines: CashInFreightDFOLine[],
    eData: CashInFreightDFOLine[],
  ): void {
    if (batchLines.length === 0) return;
    eData.push(...batchLines);
  }

  private buildLine(args: {
    rawLine: CashInFreightRawData;
    header: CashInFreightDFOHeader;
    company: string;
    voucher: number;
    lineNumber: number;
  }): CashInFreightDFOLine {
    const { rawLine, header, company, voucher, lineNumber } = args;

    const dims = this.parseToDimensions(
      rawLine.ISLEDGER
        ? rawLine.ACCOUNTDISPLAYVALUE || ''
        : rawLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const settlementAmount = Number(rawLine.CREDITAMOUNT || 0);

    const settled = new CashInFreightDFOSettled({
      JOURNALLINECOMPANY: company,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      JOURNALLINENUMBER: String(lineNumber),
      INVOICENUMBER: String(rawLine.INVOICE || ''),
      INVOICECOMPANY: company,
      INVOICEDUEDATE: '',
      ACCOUNTDISPLAYVALUE: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      CASHDISCOUNTTOTAKEININVOICECURRENCY: 0,
      INVOICEACCOUNT: String(rawLine.ACCOUNTTYPE || ''),
      INVOICETOPAYMENTCROSSRATE: 0,
      SETTLEMENTAMOUNTININVOICECURRENCY: settlementAmount,
      SourceIds: [String(rawLine.UniqueId)],
    });

    const payload: CashInFreightDFOLineBase = {
      header,
      settled,
      LineNumber: lineNumber,
      DimensionModel: dims,

      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LINENUMBER: String(lineNumber),

      ACCOUNTDISPLAYVALUE: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      ACCOUNTTYPE: String(rawLine.ACCOUNTTYPE || ''),

      BANKTRANSACTIONTYPE: rawLine.VoucherType || '',
      CALCULATEWITHHOLDINGTAX: 'No',

      CENTRALBANKIMPORTDATE: '',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',

      COMPANY: company,

      CREDITAMOUNT: Number(rawLine.CREDITAMOUNT || 0),
      CURRENCYCODE: String(rawLine.CURRENCYCODE || ''),

      CUSTOMERNAME: '',

      DEBITAMOUNT: Number(rawLine.DEBITAMOUNT || 0),

      DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: String(
        rawLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
      ),
      DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: String(
        rawLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE || '',
      ),

      DEPOSITNUMBER: '',

      EXCHANGERATE: Number(rawLine.EXCHANGERATE || 1),

      FINTAGDISPLAYVALUE: rawLine.FINTAGDISPLAYVALUE,

      ISPREPAYMENT: 'No',

      ITEMWITHHOLDINGTAXGROUP: '',

      MARKEDINVOICE: String(rawLine.INVOICE || ''),
      MARKEDINVOICECOMPANY: company,

      NACHAIATFOREIGNEXCHANGEINDICATOR: '',
      NACHAIATFOREIGNEXCHANGEREFERENCE: '',
      NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: '',
      NACHAIATOFACSCREENINGINDICATOR: '',
      NACHAIATOFACSECONDARYSCREENINGINDICATOR: '',
      NACHAIATORIGINATINGDFIQUALIFIER: '',
      NACHAIATRECEIVINGDFIQUALIFIER: '',

      OFFSETACCOUNTDISPLAYVALUE: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      OFFSETACCOUNTTYPE: String(rawLine.ACCOUNTTYPE || ''),
      OFFSETCOMPANY: company,

      OFFSETFINTAGDISPLAYVALUE: String(rawLine.FINTAGDISPLAYVALUE || ''),
      OFFSETTRANSACTIONTEXT: String(rawLine.TEXT || ''),

      OVERRIDESALESTAX: '',

      PAYMENTID: String(rawLine.UniqueId || ''),
      PAYMENTMETHODNAME: String(rawLine.VoucherType || ''),
      PAYMENTNOTES: '',
      PAYMENTREFERENCE: rawLine.DESCRIPTION || '',
      PAYMENTSPECIFICATION: '',

      POSTDATEDCHECKBANKBRANCH: '',
      POSTDATEDCHECKBANKNAME: '',
      POSTDATEDCHECKCASHIERDISPLAYVALUE: '',
      POSTDATEDCHECKISREPLACEMENTCHECK: '',
      POSTDATEDCHECKMATURITYDATE: '',
      POSTDATEDCHECKNUMBER: '',
      POSTDATEDCHECKORIGINALCHECKNUMBER: '',
      POSTDATEDCHECKREASONFORSTOP: '',
      POSTDATEDCHECKRECEIVEDDATE: '',
      POSTDATEDCHECKREPLACEMENTCOMMENTS: '',
      POSTDATEDCHECKSALESPERSONDISPLAYVALUE: '',
      POSTDATEDCHECKSTOPPAYMENT: '',

      POSTINGPROFILE: 'Cust-PP',

      REPORTINGCURRENCYEXCHRATE: '',
      REPORTINGCURRENCYEXCHRATESECONDARY: '',

      SECONDARYEXCHANGERATE: '',
      SETTLEVOUCHER: '',

      TAXGROUP: '',
      TAXITEMGROUP: '',

      THIRDPARTYBANKACCOUNTID: '',

      TRANSACTIONDATE: String(rawLine.TRANSDATE || ''),
      TRANSACTIONTEXT: '',
      VOUCHER: this.formatVoucherNumber(
        voucher,
        String(rawLine.JOURNALNAME || 'CashIn'),
      ),

      USEABANKDEPOSITSLIP: '',
      USESALESTAXDIRECTIONFROMMAINACCOUNT: '',

      SourceIds: [String(rawLine.UniqueId)],
    };

    return new CashInFreightDFOLine(payload);
  }

  private createBatchHeader(
    line: CashInFreightRawData,
    journalBatchNum: number,
  ): CashInFreightDFOHeader {
    const formattedDate = formatToMonthYear(line.TRANSDATE);

    return new CashInFreightDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      DESCRIPTION: `Customer Collection Freight ${formattedDate}`,
      ISPOSTED: 'No',
      JOURNALNAME: 'Cust-Pay',
      OVERRIDESALESTAX: 'No',
    });
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
}
