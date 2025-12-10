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
    const eData: IVendorFreightDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorFreightDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorFreightDFOHeader | null = null;
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
            this.logBatchFlush(journalBatchNum - 1, currentBatchLines.length);
            batchCount++;
          }

          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(
            monthKey,
            headerLine,
            journalBatchNum,
          );
          currentBatchLines = [];
          this.logBatchStart(
            monthKey,
            invoiceKey,
            journalBatchNum,
            currentBatchLines.length,
            invoiceCount,
          );
        }

        // Assign voucher per invoice
        const voucher = voucherNum++;
        this.vendorLogger.debug(
          `Assigning voucher ${voucher} for invoice ${invoiceKey} (${invoiceCount} lines)`,
        );

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
      this.logBatchFlush(journalBatchNum, currentBatchLines.length);
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
      if (line.accountType === 'Ledger') {
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
    const custodyVendors = await this.queryBus.execute(
      new GetVendorsQuery({ company, vendorGroupIds: ['Custody'] }),
    );
    return custodyVendors.map((v) => v.vendorAccountNumber);
  }

  private filterRawData(
    data: RawDataModel[],
    custodyAccountNumbers: string[],
  ): VendorFreightRawData[] {
    this.vendorLogger.debug(
      `Filtering ${data.length} raw records, excluding ${custodyAccountNumbers.length} custody accounts`,
    );

    const filtered = data
      .map((d) => new VendorFreightRawData(d))
      .filter((d) => {
        if (d.ISLEDGER) return true;
        const isCustody = custodyAccountNumbers.includes(d.ACCOUNTDISPLAYVALUE);
        if (isCustody) {
          this.vendorLogger.debug(
            `Excluding custody account: ${d.ACCOUNTDISPLAYVALUE}`,
          );
        }
        return !isCustody;
      });

    return filtered;
  }

  private sortLinesByMonthAndInvoice(
    lines: VendorFreightRawData[],
  ): VendorFreightRawData[] {
    this.vendorLogger.debug(
      `Sorting ${lines.length} lines by month and invoice`,
    );

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
    sortedLines: VendorFreightRawData[],
  ): Map<string, Map<string, VendorFreightRawData[]>> {
    this.vendorLogger.debug(
      `Building month → invoice map from ${sortedLines.length} sorted lines`,
    );

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
    monthKey: string,
    headerLine: VendorFreightRawData,
    journalBatchNum: number,
  ): IVendorFreightDFOHeader {
    this.vendorLogger.debug(
      `Starting new batch #${journalBatchNum} for month ${monthKey}`,
    );

    const formattedDate = formatToMonthYear(headerLine.TRANSDATE);

    const header = this.createBatchHeader(
      headerLine,
      journalBatchNum,
      formattedDate,
    );

    this.vendorLogger.debug(
      `Created batch header #${journalBatchNum} with description: ${header.description}`,
    );

    return header;
  }

  private flushBatch(
    header: IVendorFreightDFOHeader,
    batchLines: IVendorFreightDFOLine[],
    eData: IVendorFreightDFOLine[],
  ): void {
    if (batchLines.length === 0) {
      this.vendorLogger.debug('Skipping flush for empty batch');
      return;
    }

    header.journalTotalCredit = batchLines.reduce(
      (sum, l) => sum + (l.credit ?? 0),
      0,
    );
    header.journalTotalDebit = batchLines.reduce(
      (sum, l) => sum + (l.debit ?? 0),
      0,
    );

    eData.push(...batchLines);

    this.vendorLogger.debug(
      `Flushed batch #${header.journalBatchNum}: ${batchLines.length} lines, credit=${header.journalTotalCredit}, debit=${header.journalTotalDebit}`,
    );
  }

  private processInvoiceLines(
    invoiceLines: VendorFreightRawData[],
    company: string,
    header: IVendorFreightDFOHeader,
    exchangeRate: number,
    reportingRate: number,
    voucher: number,
  ): IVendorFreightDFOLine[] {
    const lineObjects: IVendorFreightDFOLine[] = [];

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

    this.vendorLogger.debug(
      `Processed ${lineObjects.length} lines for invoice with voucher ${voucher}`,
    );

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

    this.vendorLogger.debug(
      `Calculating exchange rates for ${currency} on ${dateString}`,
    );

    const exchangeRate = await this.getExchangeRate(currency, dateString, true);
    const reportingRate = await this.getExchangeRate(
      currency,
      dateString,
      false,
    );

    this.vendorLogger.debug(
      `Exchange rate for ${currency} on ${dateString} = ${exchangeRate}, reporting = ${reportingRate}`,
    );

    return { exchangeRate, reportingRate };
  }

  private createBatchHeader(
    headerLine: VendorFreightRawData,
    journalBatchNum: number,
    formattedDate: string,
  ): IVendorFreightDFOHeader {
    return new IVendorFreightDFOHeader({
      journalBatchNum,
      description: `Vendor Invoice Freight ${formattedDate}`,
      isPosted: headerLine.ISPOSTED,
      journalName: headerLine.JOURNALNAME,
      journalTotalCredit: 0,
      journalTotalDebit: 0,
      oversideSalesTax: false,
      salesTaxIncluded: true,
    });
  }

  private logBatchStart(
    monthKey: string,
    invoiceKey: string,
    batchNum: number,
    currentCount: number,
    invoiceCount: number,
  ): void {
    this.vendorLogger.debug(
      `Starting new batch #${batchNum} for month ${monthKey}, invoice ${invoiceKey}, current batch has ${currentCount} lines, adding ${invoiceCount} lines`,
    );
  }

  private logBatchFlush(batchNum: number, totalLines: number): void {
    this.vendorLogger.debug(
      `Flushing batch #${batchNum} with ${totalLines} lines`,
    );
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
    line: VendorFreightRawData,
    header: IVendorFreightDFOHeader,
    company: string,
    exchangeRate: number,
    reportingRate: number,
    uniqueId: string,
    voucherNum: number,
  ): IVendorFreightDFOLine {
    const dimensionModel = this.parseToDimensions(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    return new IVendorFreightDFOLine({
      header,
      journalBatchNum: header.journalBatchNum,
      LineNumber: line.LINENUMBER,
      accountType: line.ACCOUNTTYPE,
      DimensionModel: dimensionModel,
      company,
      credit: line.CREDITAMOUNT ?? 0,
      debit: line.DEBITAMOUNT,
      currency: line.CURRENCYCODE,
      date: line.TRANSDATE,
      description: line.TEXT,
      document: line.DOCUMENT,
      dueDate: line.DUEDATE,
      exchangeRate,
      exchangeRateSecond: 1,
      fineTagDisplayValue: line.FINTAGDISPLAYVALUE,
      invoice: line.INVOICE,
      invoiceDate: line.DOCUMENTDATE,
      isWithHoldingTaxCalculate: line.ISWITHHOLDINGCALCULATIONENABLED,
      itemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
      itemWithholdingTaxGroupCode: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
      methodOfPayment: line.PAYMENTMETHOD,
      offsetAccountDisplayValue: line.OFFSETACCOUNTDISPLAYVALUE,
      offsetAccountType: line.OFFSETACCOUNTTYPE,
      offsetCompany: company,
      offsetDefaultDimensionDisplayValue:
        line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
      offsetFinTagDisplayValue: line.OFFSETFINTAGDISPLAYVALUE,
      offsetTransactionText: line.OFFSETTEXT,
      overrideSalesTax: line.OVERRIDESALESTAX,
      payMid: Number(uniqueId),
      postingProfile: line.POSTINGPROFILE,
      reportingCurrencyExchange: reportingRate,
      salesTaxGroup: line.SALESTAXGROUP || '',
      taxExemptNumber: '',
      termsOfPayment: '',
      transactionType: 'vendor',
      voucher: voucherNum,
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
