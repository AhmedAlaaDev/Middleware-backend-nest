import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthKey, getMonthRange } from '@/lib/utils';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  RawDataModel,
  DynDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import {
  GetExchangeRatesQuery,
  GetVendorsQuery,
} from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';
import {
  IVendorFreightDFOHeader,
  IVendorFreightDFOLine,
} from '@/modules/vendor/interfaces/vendor-freight-dfo-data.interface';
import { VendorFreightRawData } from '@/modules/vendor/models/vendor-freight-raw-data.model';

@Injectable()
export class VendorFreightEntryProcessor extends EntryProcessorBase {
  private readonly vendorLogger = new Logger(VendorFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------
  readonly entryProcessorType = EntryProcessorTypes.VendorFreight;
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
    this.vendorLogger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Filter raw data
    const custodyAccountNumbers = await this.getCustodyAccountNumbers(company);
    const filteredLines = this.filterRawData(data, custodyAccountNumbers);
    this.logInitialStats(rawCount, filteredLines.length);

    // STEP 2: Sort by month and invoice
    const sortedLines = this.sortLinesByLineNumber(filteredLines);
    this.vendorLogger.debug(
      `Sorted ${sortedLines.length} lines by line number`,
    );

    // STEP 3: Build month → invoice map
    const monthVoucherMap = this.buildVoucherMap(sortedLines);
    const monthCount = monthVoucherMap.size;
    const voucherCount = Array.from(monthVoucherMap.values()).reduce(
      (sum, voucherMap) => sum + voucherMap.size,
      0,
    );
    this.vendorLogger.debug(
      `Grouped ${sortedLines.length} lines into ${monthCount} months and ${voucherCount} vouchers`,
    );

    // STEP 4: Initialize batch processing
    const eData: IVendorFreightDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorFreightDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorFreightDFOHeader | null = null;
    let batchCount = 0;
    let lineNumber = 1;

    // STEP 5: Process each month → invoice

    for (const [monthKey, voucherMap] of monthVoucherMap.entries()) {
      for (const [voucherKey, lines] of voucherMap.entries()) {
        const headerLine = lines[0];
        const lineCount = lines.length;

        if (lineCount === 0) {
          this.vendorLogger.warn(
            `Voucher ${voucherKey} has zero lines, skipping`,
          );
          continue;
        }

        const monthChanged = currentBatchMonth !== monthKey;
        const wouldExceedLimit =
          currentBatchLines.length + lineCount > this.MAX_LINES_PER_BATCH;

        // Check if we need a new batch
        if (monthChanged || wouldExceedLimit || currentHeader === null) {
          // Close previous batch if it had lines
          if (currentBatchLines.length > 0) {
            journalBatchNum++;
            this.flushBatch(currentHeader!, currentBatchLines, eData);
            batchCount++;
            lineNumber = 0;
          }

          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(headerLine, journalBatchNum);
          currentBatchLines = [];
        }

        // Assign voucher per invoice
        const voucher = voucherNum++;

        // Calculate exchange rates once per invoice
        const { exchangeRate, reportingRate } =
          await this.calculateExchangeRates(headerLine);

        if (!currentHeader) {
          this.vendorLogger.error('Current header is unexpectedly null');
          throw new Error('Current header is unexpectedly null');
        }

        // Process invoice lines
        const invoiceLineObjects = await this.processInvoiceLines(
          lines,
          company,
          currentHeader,
          exchangeRate,
          reportingRate,
          voucher,
          () => lineNumber++,
        );

        currentBatchLines.push(...invoiceLineObjects);
      }
    }

    // STEP 6: Final flush
    if (currentBatchLines.length > 0 && currentHeader) {
      batchCount++;
      this.flushBatch(currentHeader, currentBatchLines, eData);
    }

    // Final summary
    this.logFinalStats(batchCount, eData.length);

    return eData as unknown as DynDataModel[];
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as IVendorFreightDFOLine[];

    const dimensionsMap = await this.loadDimensionsMap();
    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

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

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private async getCustodyAccountNumbers(company: string): Promise<string[]> {
    const custodyVendorsRes = await this.queryBus.execute(
      new GetVendorsQuery({ company, vendorGroupIds: ['Custody'] }),
    );
    return (custodyVendorsRes?.items ?? []).map((v) => v.vendorAccountNumber);
  }

  private async getVendorTaxNumberAndTermsOfPayment(
    company: string,
    vendorAccountNumber: string,
  ): Promise<{ taxNumber: string; termsOfPayment: string }> {
    const vendorRes = await this.queryBus.execute(
      new GetVendorsQuery({ company, accountNumbers: [vendorAccountNumber] }),
    );

    const vendors = vendorRes?.items ?? [];
    if (vendors.length === 0) {
      return { taxNumber: '', termsOfPayment: '' };
    }

    // regesteriation id
    const taxNumber = vendors[0].salesTaxGroupCode || '';
    const termsOfPayment = vendors[0].defaultPaymentTermsName || '';

    return { taxNumber, termsOfPayment };
  }

  private filterRawData(
    data: RawDataModel[],
    custodyAccountNumbers: string[],
  ): VendorFreightRawData[] {
    const filtered = data
      .map((d) => new VendorFreightRawData(d))
      .filter((d) => {
        if (d.ISLEDGER) return true;
        const isCustody = custodyAccountNumbers.includes(d.ACCOUNTDISPLAYVALUE);
        return !isCustody;
      });

    return filtered;
  }

  private sortLinesByLineNumber(
    lines: VendorFreightRawData[],
  ): VendorFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private sortLinesByMonthAndInvoice(
    lines: VendorFreightRawData[],
  ): VendorFreightRawData[] {
    const sorted = [...lines].sort((a, b) => {
      let monthA: string;
      let monthB: string;

      try {
        monthA = getMonthKey(a.TRANSDATE);
      } catch (_error) {
        this.vendorLogger.warn(
          `Invalid date format for line ${a.UniqueId}: ${a.TRANSDATE}`,
        );
        monthA = 'invalid-date';
      }

      try {
        monthB = getMonthKey(b.TRANSDATE);
      } catch (_error) {
        this.vendorLogger.warn(
          `Invalid date format for line ${b.UniqueId}: ${b.TRANSDATE}`,
        );
        monthB = 'invalid-date';
      }

      if (monthA !== monthB) {
        return monthA.localeCompare(monthB);
      }

      const invA = a.INVOICE?.toLowerCase().trim() || 'no_invoice';
      const invB = b.INVOICE?.toLowerCase().trim() || 'no_invoice';

      return invA.localeCompare(invB);
    });

    return sorted;
  }

  private buildVoucherMap(
    sortedLines: VendorFreightRawData[],
  ): Map<string, Map<string, VendorFreightRawData[]>> {
    const monthInvoiceMap = new Map<
      string,
      Map<string, VendorFreightRawData[]>
    >();

    for (const line of sortedLines) {
      let monthKey: string;

      try {
        monthKey = getMonthKey(line.TRANSDATE);
      } catch (_error) {
        this.vendorLogger.warn(
          `Invalid date format for line ${line.UniqueId}: ${line.TRANSDATE}`,
        );
        monthKey = 'invalid-date';
      }

      const voucherKey = line.VOUCHER;

      if (!monthInvoiceMap.has(monthKey)) {
        monthInvoiceMap.set(monthKey, new Map());
      }

      const voucherMap = monthInvoiceMap.get(monthKey)!;

      if (!voucherMap.has(voucherKey)) {
        voucherMap.set(voucherKey, []);
      }

      voucherMap.get(voucherKey)!.push(line);
    }

    return monthInvoiceMap;
  }

  private buildMonthInvoiceMap(
    sortedLines: VendorFreightRawData[],
  ): Map<string, Map<string, VendorFreightRawData[]>> {
    const monthInvoiceMap = new Map<
      string,
      Map<string, VendorFreightRawData[]>
    >();

    for (const line of sortedLines) {
      let monthKey: string;
      try {
        monthKey = getMonthKey(line.TRANSDATE);
      } catch (_error) {
        this.vendorLogger.warn(
          `Invalid date format for line ${line.UniqueId}: ${line.TRANSDATE}`,
        );
        monthKey = 'invalid-date';
      }

      const invoiceKey = line.INVOICE?.toLowerCase().trim() || 'no_invoice';

      if (!monthInvoiceMap.has(monthKey)) {
        monthInvoiceMap.set(monthKey, new Map());
      }

      const invoiceMap = monthInvoiceMap.get(monthKey)!;

      if (!invoiceMap.has(invoiceKey)) {
        invoiceMap.set(invoiceKey, []);
      }

      invoiceMap.get(invoiceKey)!.push(line);
    }

    return monthInvoiceMap;
  }

  private startNewBatch(
    headerLine: VendorFreightRawData,
    journalBatchNum: number,
  ): IVendorFreightDFOHeader {
    const formattedDate = formatToMonthYear(headerLine.TRANSDATE);

    const header = this.createBatchHeader(
      headerLine,
      journalBatchNum,
      formattedDate,
    );

    return header;
  }

  private flushBatch(
    header: IVendorFreightDFOHeader,
    batchLines: IVendorFreightDFOLine[],
    eData: IVendorFreightDFOLine[],
  ): void {
    if (batchLines.length === 0) {
      return;
    }

    eData.push(...batchLines);
  }

  private async processInvoiceLines(
    invoiceLines: VendorFreightRawData[],
    company: string,
    header: IVendorFreightDFOHeader,
    exchangeRate: number,
    reportingRate: number,
    voucher: number,
    lineNumber: () => number,
  ): Promise<IVendorFreightDFOLine[]> {
    const lineObjects: IVendorFreightDFOLine[] = [];

    for (const line of invoiceLines) {
      const obj = await this.buildLine(
        line,
        header,
        company,
        exchangeRate,
        reportingRate,
        line.UniqueId.toString(),
        voucher,
        lineNumber(),
      );
      lineObjects.push(obj);
    }

    return lineObjects;
  }

  private async calculateExchangeRates(
    headerLine: VendorFreightRawData,
  ): Promise<{
    exchangeRate: number;
    reportingRate: number;
  }> {
    const dateString = headerLine.TRANSDATE;
    const currency = headerLine.CURRENCYCODE;

    const exchangeRate = await this.getExchangeRate(
      currency,
      dateString,
      'EGP',
    );
    const reportingRate = await this.getExchangeRate(
      currency,
      dateString,
      'USD',
    );

    return { exchangeRate, reportingRate };
  }

  private createBatchHeader(
    headerLine: VendorFreightRawData,
    journalBatchNum: number,
    formattedDate: string,
  ): IVendorFreightDFOHeader {
    return new IVendorFreightDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      DESCRIPTION: `Vendor Invoice Freight ${formattedDate}`,
      JOURNALNAME: headerLine.JOURNALNAME,
      OVERRIDESALESTAX: 'No',
      SALESTAXINCLUDED: 'Yes',
    });
  }

  private logInitialStats(rawCount: number, filteredCount: number): void {
    const excluded = rawCount - filteredCount;
    this.vendorLogger.debug(
      `Filtered ${rawCount} raw records → ${filteredCount} valid records (excluded ${excluded} custody accounts)`,
    );
  }

  private logFinalStats(totalBatches: number, totalLines: number): void {
    this.vendorLogger.debug(
      `Final output = ${totalLines} enriched lines across ${totalBatches} batches`,
    );
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
          new GetSettingQuery('last.ledger.vendor.freight.voucher.number'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }

  private async getExchangeRate(
    currency: string,
    date: string,
    toCurrency: 'EGP' | 'USD',
  ) {
    if (currency === toCurrency) return 1;

    const dateRange = getMonthRange(date);

    const fromDate = dateRange?.fromDate;
    const toDate = dateRange?.toDate;

    const rate = (
      await this.queryBus.execute(
        new GetExchangeRatesQuery(
          {
            rateTypeName: 'default',
            fromCurrency: currency,
            toCurrency,
            fromDate,
            toDate,
          },
          undefined,
          undefined,
        ),
      )
    )?.items?.[0]?.rate;

    return rate ?? 1;
  }

  private async buildLine(
    line: VendorFreightRawData,
    header: IVendorFreightDFOHeader,
    company: string,
    exchangeRate: number,
    reportingRate: number,
    uniqueId: string,
    voucherNum: number,
    lineNumber: number,
  ): Promise<IVendorFreightDFOLine> {
    const dimensionModel = this.parseToDimensions(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const { taxNumber, termsOfPayment } = line.ISVENDOR
      ? await this.getVendorTaxNumberAndTermsOfPayment(
          company,
          line.ACCOUNTDISPLAYVALUE,
        )
      : { taxNumber: '', termsOfPayment: '' };

    return new IVendorFreightDFOLine({
      header,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LineNumber: lineNumber,
      LINENUMBER: lineNumber.toString(),
      ACCOUNTTYPE: line.ACCOUNTTYPE,
      ACCOUNTDISPLAYVALUE: line.ACCOUNTDISPLAYVALUE,
      DEFAULTDIMENSIONDISPLAYVALUE: line.DEFAULTDIMENSIONDISPLAYVALUE,
      DimensionModel: dimensionModel,
      COMPANY: company,
      CREDIT: line.CREDITAMOUNT ?? 0,
      DEBIT: line.DEBITAMOUNT,
      CURRENCY: line.CURRENCYCODE,
      DATE: line.TRANSDATE,
      DESCRIPTION: line.TEXT,
      DOCUMENT: line.DOCUMENT,
      DUEDATE: line.DUEDATE,
      EXCHRATE: exchangeRate,
      EXCHRATESECOND: 0,
      FINTAGDISPLAYVALUE: line.FINTAGDISPLAYVALUE,
      INVOICE: line.INVOICE,
      INVOICEDATE: line.DOCUMENTDATE,
      ISWITHHOLDINGTAXCALCULATE: line.ISWITHHOLDINGCALCULATIONENABLED
        ? 'Yes'
        : 'No',
      ITEMSALESTAXGROUP: line.ITEMSALESTAXGROUP || '',
      ITEMWITHHOLDINGTAXGROUPCODE: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
      METHODOFPAYMENT: line.PAYMENTMETHOD,
      OFFSETACCOUNTDISPLAYVALUE: line.OFFSETACCOUNTDISPLAYVALUE,
      OFFSETACCOUNTTYPE: line.OFFSETACCOUNTTYPE,
      OFFSETCOMPANY: company,
      OFFSETDEFAULTDIMENSIONDISPLAYVALUE:
        line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
      OFFSETFINTAGDISPLAYVALUE: line.OFFSETFINTAGDISPLAYVALUE,
      OFFSETTRANSACTIONTEXT: line.OFFSETTEXT,
      OVERRIDESALESTAX: line.OVERRIDESALESTAX,
      PAYMID: Number(uniqueId),
      POSTINGPROFILE: line.POSTINGPROFILE,
      REPORTINGCURRENCYEXCHRATE: reportingRate,
      SALESTAXGROUP: line.SALESTAXGROUP || '',
      TAXEXEMPTNUMBER: taxNumber,
      TERMSOFPAYMENT: termsOfPayment,
      TRANSACTIONTYPE: 'vendor',
      VOUCHER: this.formatVoucherNumber(voucherNum, line.JOURNALNAME),
      SourceIds: [uniqueId],
    });
  }

  private async loadDimensionsMap() {
    const map: Record<string, IFinancialDimensionValue[]> = {};

    for (const key of this.requiredDimensions) {
      map[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    return map;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}
