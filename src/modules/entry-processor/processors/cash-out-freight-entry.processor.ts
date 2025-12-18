import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthKey } from '@/lib/utils';
import {
  CashOutFreightDFOLine,
  CashOutFreightDFOLineBase,
  CashOutFreightDFOHeader,
  CashOutFreightDFOSettled,
} from '@/modules/cash-out/interfaces/cash-out-freight-dfo-data.interface';
import { CashOutFreightRawData } from '@/modules/cash-out/models/cash-out-freight-raw-data.model';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetVendorsQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

type MonthVoucherMap = Map<string, Map<string, CashOutFreightRawData[]>>;

@Injectable()
export class CashOutFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(CashOutFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashOutFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'ChargeType',
    'SalesMan',
    'FreightType',
    'CoordinatorMan',
    'Direction',
    'Vendor',
    'SubVendor',
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
    const eData: CashOutFreightDFOLine[] = [];

    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();

    let currentBatchLines: CashOutFreightDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: CashOutFreightDFOHeader | null = null;
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
          const enrichedLine = await this.buildLine({
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
    const lines = data as unknown as CashOutFreightDFOLine[];

    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    const dimensionsMap: Record<string, IFinancialDimensionValue[]> = {};
    for (const key of this.requiredDimensions) {
      dimensionsMap[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    for (const line of lines) {
      if (line.ACCOUNTTYPE === 'Ledger') {
        this.validateMainAccount(line, mainAccounts);
      }
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      this.validateBusinessUnit(line, dimensionsMap.BusinessUnit);
      this.validateLocation(line, dimensionsMap.Location);
      this.validateSalesMan(line, dimensionsMap.SalesMan);
      this.validateFreightType(line, dimensionsMap.FreightType);
      this.validateCoordinatorMan(line, dimensionsMap.CoordinatorMan);
      this.validateDirection(line, dimensionsMap.Direction);
      this.validateVendor(line, dimensionsMap.Vendor);

      if (line.DimensionModel.subVendor) {
        this.validateSubVendor(line, dimensionsMap.SubVendor);
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

  private mapToModels(data: RawDataModel[]): CashOutFreightRawData[] {
    return data.map((d) => new CashOutFreightRawData(d));
  }

  private sortLinesByLineNumber(
    lines: CashOutFreightRawData[],
  ): CashOutFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private buildVoucherMap(
    sortedLines: CashOutFreightRawData[],
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

  private safeMonthKey(line: CashOutFreightRawData): string {
    try {
      return getMonthKey(line.TRANSDATE);
    } catch {
      return 'invalid-date';
    }
  }

  private safeVoucherKey(line: CashOutFreightRawData): string {
    const v = String(line.VOUCHER || '').trim();
    return v || `uid-${String(line.UniqueId)}`;
  }

  private startNewBatch(
    headerLine: CashOutFreightRawData,
    journalBatchNum: number,
  ): CashOutFreightDFOHeader {
    return this.createBatchHeader(headerLine, journalBatchNum);
  }

  private flushBatch(
    _header: CashOutFreightDFOHeader,
    batchLines: CashOutFreightDFOLine[],
    eData: CashOutFreightDFOLine[],
  ): void {
    if (batchLines.length === 0) return;
    eData.push(...batchLines);
  }

  private async buildLine(args: {
    rawLine: CashOutFreightRawData;
    header: CashOutFreightDFOHeader;
    company: string;
    voucher: number;
    lineNumber: number;
  }): Promise<CashOutFreightDFOLine> {
    const { rawLine, header, company, voucher, lineNumber } = args;

    const dims = this.parseToDimensions(
      rawLine.ISLEDGER
        ? rawLine.ACCOUNTDISPLAYVALUE || ''
        : rawLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const settlementAmount = Number(rawLine.CREDITAMOUNT || 0);

    const settled = new CashOutFreightDFOSettled({
      JOURNALLINECOMPANY: company,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      JOURNALLINENUMBER: String(lineNumber),
      INVOICENUMBER: String(rawLine.INVOICE || ''),
      INVOICECOMPANY: company,
      INVOICEDUEDATE: '',
      ACCOUNTDISPLAYVALUE: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      CASHDISCOUNTTOTAKEININVOICECURRENCY: 0,
      INVOICEACCOUNT: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      INVOICETOPAYMENTCROSSRATE: 0,
      SETTLEMENTAMOUNTININVOICECURRENCY: settlementAmount,
      SourceIds: [String(rawLine.UniqueId)],
    });

    const vendorName = await this.getVendorName(
      rawLine.ACCOUNTTYPE,
      rawLine.ACCOUNTDISPLAYVALUE,
      company,
    );

    const paymentReference =
      rawLine.PAYMENTREFERENCE || rawLine.DESCRIPTION || '';

    const payload: CashOutFreightDFOLineBase = {
      header,
      settled,
      LineNumber: lineNumber,
      DimensionModel: dims,

      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LINENUMBER: String(lineNumber),

      ACCOUNTDISPLAYVALUE: String(rawLine.ACCOUNTDISPLAYVALUE || ''),
      ACCOUNTTYPE: String(rawLine.ACCOUNTTYPE || ''),

      BANKTRANSACTIONTYPE: '',

      CALCULATEWITHHOLDINGTAX: rawLine.ISWITHHOLDINGCALCULATIONENABLED
        ? 'Yes'
        : 'No',

      CATEGORYPURPOSE: '',
      CENTRALBANKIMPORTDATE: '',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',
      CHARGEBEARER: '',

      CHECKNUMBER: paymentReference,
      COMPANY: company,

      CREDITAMOUNT: Number(rawLine.CREDITAMOUNT || 0),
      CURRENCYCODE: String(rawLine.CURRENCYCODE || ''),
      DEBITAMOUNT: Number(rawLine.DEBITAMOUNT || 0),

      DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: String(
        rawLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
      ),
      DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: String(
        rawLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE ||
          rawLine.DEFAULTDIMENSIONDISPLAYVALUE ||
          '',
      ),

      ERRORCODEPAYMENT: '',

      EXCHANGERATE: Number(rawLine.EXCHANGERATE || 1),
      FINTAGDISPLAYVALUE: rawLine.FINTAGDISPLAYVALUE,

      FULLPRIMARYREMITTANCEADDRESS: '',

      ISPREPAYMENT: 'No',

      ITEMWITHHOLDINGTAXGROUPCODE: '',

      LOCALINSTRUMENT: '',

      MARKEDINVOICE: String(rawLine.INVOICE || ''),
      MARKEDINVOICECOMPANY: company,

      NACHAIATFOREIGNEXCHANGEINDICATOR: '',
      NACHAIATFOREIGNEXCHANGEREFERENCE: '',
      NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: '',
      NACHAIATOFACSCREENINGINDICATOR: '',
      NACHAIATOFACSECONDARYSCREENINGINDICATOR: '',
      NACHAIATORIGINATINGDFIQUALIFIER: '',
      NACHAIATRECEIVINGDFIQUALIFIER: '',

      NEWJOURNALBATCHNUMBER: '',

      OFFSETACCOUNTDISPLAYVALUE: String(
        rawLine.OFFSETACCOUNTDISPLAYVALUE || rawLine.ACCOUNTDISPLAYVALUE || '',
      ),
      OFFSETACCOUNTTYPE: String(
        rawLine.OFFSETACCOUNTTYPE || rawLine.ACCOUNTTYPE || '',
      ),
      OFFSETCOMPANY: company,

      OFFSETFINTAGDISPLAYVALUE: String(
        rawLine.OFFSETFINTAGDISPLAYVALUE || rawLine.FINTAGDISPLAYVALUE || '',
      ),
      OFFSETTRANSACTIONTEXT: String(rawLine.OFFSETTEXT || rawLine.TEXT || ''),

      OVERRIDESALESTAX: '',

      PAYMENTID: String(rawLine.UniqueId || ''),
      PAYMENTMETHODNAME: String(rawLine.PAYMENTMETHOD || ''),
      PAYMENTREFERENCE: paymentReference,

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

      POSTINGPROFILE: String(rawLine.POSTINGPROFILE || ''),

      REMITTANCEADDRESSCITY: '',
      REMITTANCEADDRESSCOUNTRY: '',
      REMITTANCEADDRESSCOUNTRYISOCODE: '',
      REMITTANCEADDRESSCOUNTY: '',
      REMITTANCEADDRESSDESCRIPTION: '',
      REMITTANCEADDRESSDISTRICTNAME: '',
      REMITTANCEADDRESSLATITUDE: '',
      REMITTANCEADDRESSLONGITUDE: '',
      REMITTANCEADDRESSSTATE: '',
      REMITTANCEADDRESSSTREET: '',
      REMITTANCEADDRESSTIMEZONE: '',
      REMITTANCEADDRESSVALIDFROM: '',
      REMITTANCEADDRESSVALIDTO: '',
      REMITTANCEADDRESSZIPCODE: '',
      REMITTANCELOCATIONID: '',

      REPORTINGCURRENCYEXCHRATE: '',
      REPORTINGCURRENCYEXCHRATESECONDARY: '',
      SECONDARYEXCHANGERATE: '',

      SERVICELEVEL: '',

      SETTLEVOUCHER: '',

      TAXGROUP: String(rawLine.SALESTAXGROUP || ''),
      TAXITEMGROUP: '',
      TAXWITHHOLDGROUP: '',

      THIRDPARTYBANKACCOUNTID: '',

      TRANSACTIONDATE: String(rawLine.TRANSDATE || ''),
      TRANSACTIONTEXT: String(rawLine.TEXT || ''),
      VOUCHER: this.formatVoucherNumber(
        voucher,
        String(rawLine.JOURNALNAME || 'CashOut'),
      ),

      USESALESTAXDIRECTIONFROMMAINACCOUNT: 'No',

      VENDORNAME: vendorName,

      SourceIds: [String(rawLine.UniqueId)],
    };

    return new CashOutFreightDFOLine(payload);
  }

  private async getVendorName(
    accountType: string,
    accountDisplayValue: string,
    company: string,
  ): Promise<string> {
    if (accountType.toLowerCase() !== 'vend') return '';

    const vendors = await this.queryBus.execute(
      new GetVendorsQuery({
        company: company,
        accountNumbers: [accountDisplayValue],
      }),
    );

    return vendors?.items[0]?.vendorOrganizationName || '';
  }

  private createBatchHeader(
    line: CashOutFreightRawData,
    journalBatchNum: number,
  ): CashOutFreightDFOHeader {
    const formattedDate = formatToMonthYear(line.TRANSDATE);

    return new CashOutFreightDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      CATEGORYPURPOSE: 0,
      CHARGEBEARER: 0,
      DESCRIPTION: `Vendor Payment  Freight ${formattedDate}`,
      ISPOSTED: 'No',
      JOURNALNAME: 'P-Freight',
      LOCALINSTRUMENT: 0,
      OVERRIDESALESTAX: 'No',
      SERVICELEVEL: 0,
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
          new GetSettingQuery('last.ledger.voucher.cash.out.freight'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }
}
