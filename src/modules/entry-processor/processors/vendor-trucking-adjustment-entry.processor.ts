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
  IVendorTruckingAdjustmentDFOHeader,
  IVendorTruckingAdjustmentDFOLine,
} from '@/modules/vendor/interfaces/vendor-trucking-adjustment-dfo-data.interface';
import { VendorTruckingAdjustmentRawData } from '@/modules/vendor/models/vendor-trucking-adjustment-raw-data.model';

@Injectable()
export class VendorTruckingAdjustmentEntryProcessor extends EntryProcessorBase {
  private readonly vendorLogger = new Logger(
    VendorTruckingAdjustmentEntryProcessor.name,
  );

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------
  readonly entryProcessorType = EntryProcessorTypes.VendorTruckingAdjustment;
  private readonly MAX_LINES_PER_BATCH = 1000;
  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
    'TruckerType',
    'TruckNumber',
    'Vendor',
    'SubVendor',
    'Worker',
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
    const sortedLines = this.sortLinesByMonthAndInvoice(filteredLines);
    this.vendorLogger.debug(
      `Sorted ${sortedLines.length} lines by month and invoice`,
    );

    // STEP 3: Build month → invoice map
    const monthInvoiceMap = this.buildMonthInvoiceMap(sortedLines);
    const monthCount = monthInvoiceMap.size;
    const invoiceCount = Array.from(monthInvoiceMap.values()).reduce(
      (sum, invoiceMap) => sum + invoiceMap.size,
      0,
    );
    this.vendorLogger.debug(
      `Grouped ${sortedLines.length} lines into ${monthCount} months and ${invoiceCount} invoices`,
    );

    // STEP 4: Initialize batch processing
    const eData: IVendorTruckingAdjustmentDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorTruckingAdjustmentDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorTruckingAdjustmentDFOHeader | null = null;
    let batchCount = 0;

    // STEP 5: Process each month → invoice
    for (const [monthKey, invoiceMap] of monthInvoiceMap.entries()) {
      for (const [invoiceKey, invoiceLines] of invoiceMap.entries()) {
        const headerLine = invoiceLines[0];
        const invoiceCount = invoiceLines.length;

        if (invoiceCount === 0) {
          this.vendorLogger.warn(
            `Invoice ${invoiceKey} has zero lines, skipping`,
          );
          continue;
        }

        const monthChanged = currentBatchMonth !== monthKey;
        const wouldExceedLimit =
          currentBatchLines.length + invoiceCount > this.MAX_LINES_PER_BATCH;

        // Check if we need a new batch
        if (monthChanged || wouldExceedLimit || currentHeader === null) {
          // Close previous batch if it had lines
          if (currentBatchLines.length > 0) {
            journalBatchNum++;
            this.flushBatch(currentHeader!, currentBatchLines, eData);
            batchCount++;
          }

          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(
            monthKey,
            headerLine,
            journalBatchNum,
          );
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
        const invoiceLineObjects = this.processInvoiceLines(
          invoiceLines,
          company,
          currentHeader,
          exchangeRate,
          reportingRate,
          voucher,
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
    const lines = data as unknown as IVendorTruckingAdjustmentDFOLine[];

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
      this.validateTruckerType(line, dimensionsMap.TruckerType);
      if (
        line.DimensionModel.truckerType === '11' ||
        line.DimensionModel.truckerType === '12'
      ) {
        this.validateTruckNumber(line, dimensionsMap.TruckNumber);
      }

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
    const custodyVendors = await this.queryBus.execute(
      new GetVendorsQuery({ company, vendorGroupIds: ['Custody'] }),
    );
    return custodyVendors.map((v) => v.vendorAccountNumber);
  }

  private filterRawData(
    data: RawDataModel[],
    custodyAccountNumbers: string[],
  ): VendorTruckingAdjustmentRawData[] {
    const filtered = data
      .map((d) => new VendorTruckingAdjustmentRawData(d))
      .filter((d) => {
        if (d.ISLEDGER) return true;
        const isCustody = custodyAccountNumbers.includes(d.ACCOUNTDISPLAYVALUE);
        return !isCustody;
      });

    return filtered;
  }

  private sortLinesByMonthAndInvoice(
    lines: VendorTruckingAdjustmentRawData[],
  ): VendorTruckingAdjustmentRawData[] {
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

  private buildMonthInvoiceMap(
    sortedLines: VendorTruckingAdjustmentRawData[],
  ): Map<string, Map<string, VendorTruckingAdjustmentRawData[]>> {
    const monthInvoiceMap = new Map<
      string,
      Map<string, VendorTruckingAdjustmentRawData[]>
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
    monthKey: string,
    headerLine: VendorTruckingAdjustmentRawData,
    journalBatchNum: number,
  ): IVendorTruckingAdjustmentDFOHeader {
    const formattedDate = formatToMonthYear(headerLine.TRANSDATE);

    const header = this.createBatchHeader(
      headerLine,
      journalBatchNum,
      formattedDate,
    );

    return header;
  }

  private flushBatch(
    header: IVendorTruckingAdjustmentDFOHeader,
    batchLines: IVendorTruckingAdjustmentDFOLine[],
    eData: IVendorTruckingAdjustmentDFOLine[],
  ): void {
    if (batchLines.length === 0) {
      return;
    }

    header.JOURNALTOTALCREDIT = batchLines.reduce(
      (sum, l) => sum + (l.CREDIT ?? 0),
      0,
    );
    header.JOURNALTOTALDEBIT = batchLines.reduce(
      (sum, l) => sum + (l.DEBIT ?? 0),
      0,
    );

    eData.push(...batchLines);
  }

  private processInvoiceLines(
    invoiceLines: VendorTruckingAdjustmentRawData[],
    company: string,
    header: IVendorTruckingAdjustmentDFOHeader,
    exchangeRate: number,
    reportingRate: number,
    voucher: number,
  ): IVendorTruckingAdjustmentDFOLine[] {
    const lineObjects: IVendorTruckingAdjustmentDFOLine[] = [];

    for (const line of invoiceLines) {
      const obj = this.buildLine(
        line,
        header,
        company,
        exchangeRate,
        reportingRate,
        line.UniqueId.toString(),
        voucher,
      );
      lineObjects.push(obj);
    }

    return lineObjects;
  }

  private async calculateExchangeRates(
    headerLine: VendorTruckingAdjustmentRawData,
  ): Promise<{
    exchangeRate: number;
    reportingRate: number;
  }> {
    const dateString = headerLine.TRANSDATE;
    const currency = headerLine.CURRENCYCODE;

    const exchangeRate = await this.getExchangeRate(currency, dateString, true);
    const reportingRate = await this.getExchangeRate(
      currency,
      dateString,
      false,
    );

    return { exchangeRate, reportingRate };
  }

  private createBatchHeader(
    headerLine: VendorTruckingAdjustmentRawData,
    journalBatchNum: number,
    formattedDate: string,
  ): IVendorTruckingAdjustmentDFOHeader {
    return new IVendorTruckingAdjustmentDFOHeader({
      JOURNALBATCHNUM: this.formatBatchNumber(journalBatchNum),
      DESCRIPTION: `Vendor Invoice Fleet Adjustment ${formattedDate}`,
      ISPOSTED: headerLine.ISPOSTED,
      JOURNALNAME: headerLine.JOURNALNAME,
      JOURNALTOTALCREDIT: 0,
      JOURNALTOTALDEBIT: 0,
      OVERSIDESALESTAX: false,
      SALESTAXINCLUDED: true,
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
    toEgp: boolean,
  ) {
    if (currency === 'EGP') return 1;

    const dateRange = getMonthRange(date);

    const from = dateRange?.fromDate?.toDateString();
    const to = dateRange?.toDate?.toDateString();

    const query = toEgp
      ? new GetExchangeRatesQuery('default', currency, 'EGP', from, to)
      : new GetExchangeRatesQuery('default', 'EGP', currency, from, to);

    return (await this.queryBus.execute(query))?.[0]?.rate;
  }

  private buildLine(
    line: VendorTruckingAdjustmentRawData,
    header: IVendorTruckingAdjustmentDFOHeader,
    company: string,
    exchangeRate: number,
    reportingRate: number,
    uniqueId: string,
    voucherNum: number,
  ): IVendorTruckingAdjustmentDFOLine {
    const dimensionModel = this.parseToDimensions(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    return new IVendorTruckingAdjustmentDFOLine({
      header,
      JOURNALBATCHNUM: header.JOURNALBATCHNUM,
      LineNumber: line.LINENUMBER,
      ACCOUNTTYPE: line.ACCOUNTTYPE,
      DimensionModel: dimensionModel,
      COMPANY: company,
      CREDIT: line.CREDITAMOUNT ?? 0,
      DEBIT: line.DEBITAMOUNT,
      CURRENCY: line.CURRENCYCODE,
      DATE: line.TRANSDATE,
      DESCRIPTION: line.TEXT,
      DOCUMENT: line.DOCUMENT,
      DUEDATE: line.DUEDATE,
      EXCHANGERATE: exchangeRate,
      EXCHANGERATESECOND: 1,
      FINETAGDISPLAYVALUE: line.FINTAGDISPLAYVALUE,
      INVOICE: line.INVOICE,
      INVOICEDATE: line.DOCUMENTDATE,
      ISWITHHOLDINGTAXCALCULATE: line.ISWITHHOLDINGCALCULATIONENABLED,
      ITEMSALESTAXGROUP: line.ITEMSALESTAXGROUP || '',
      ITEMWITHHOLDINGTAXGROUPCODE: '',
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
      REPORTINGCURRENCYEXCHANGE: reportingRate,
      SALESTAXGROUP: line.SALESTAXGROUP || '',
      TAXEXEMPTNUMBER: '',
      TERMSOFPAYMENT: '',
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
