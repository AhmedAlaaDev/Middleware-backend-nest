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
    this.vendorLogger.debug(
      `[STEP 1] Fetching custody account numbers for company: ${company}`,
    );
    const custodyAccountNumbers = await this.getCustodyAccountNumbers(company);
    this.vendorLogger.debug(
      `[STEP 1] Found ${custodyAccountNumbers.length} custody accounts`,
    );
    const filteredLines = this.filterRawData(data, custodyAccountNumbers);
    this.logInitialStats(rawCount, filteredLines.length);

    // STEP 2: Sort by month and invoice
    const sortedLines = this.sortLinesByLineNumber(filteredLines);
    this.vendorLogger.debug(
      `Sorted ${sortedLines.length} lines by line number`,
    );

    // STEP 3: Build month → invoice map
    this.vendorLogger.debug(
      `[STEP 3] Building voucher map from ${sortedLines.length} lines`,
    );
    const monthVoucherMap = this.buildVoucherMap(sortedLines);
    const monthCount = monthVoucherMap.size;
    const voucherCount = Array.from(monthVoucherMap.values()).reduce(
      (sum, voucherMap) => sum + voucherMap.size,
      0,
    );
    this.vendorLogger.debug(
      `[STEP 3] Grouped into ${monthCount} months and ${voucherCount} vouchers`,
    );

    // STEP 4: Initialize batch processing
    this.vendorLogger.debug(`[STEP 4] Initializing batch processing`);
    const eData: IVendorFreightDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorFreightDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorFreightDFOHeader | null = null;
    let batchCount = 0;
    let lineNumber = 1;
    this.vendorLogger.debug(
      `[STEP 4] Starting with batch number: ${journalBatchNum}, voucher number: ${voucherNum}`,
    );

    // STEP 5: Process each month → invoice

    for (const [monthKey, voucherMap] of monthVoucherMap.entries()) {
      for (const [_voucherKey, lines] of voucherMap.entries()) {
        const headerLine = lines[0];
        const lineCount = lines.length;

        if (lineCount === 0) {
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
            lineNumber = 1;
            this.vendorLogger.debug(
              `[BATCH] Flushed batch ${journalBatchNum - 1} with ${currentBatchLines.length} lines`,
            );
          }

          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(headerLine, journalBatchNum);
          currentBatchLines = [];
          this.vendorLogger.debug(
            `[BATCH] Started new batch ${journalBatchNum} for month: ${monthKey}`,
          );
        }

        // Assign voucher per invoice
        const voucher = voucherNum++;

        if (!currentHeader) {
          this.vendorLogger.error('Current header is unexpectedly null');
          throw new Error('Current header is unexpectedly null');
        }

        // Process invoice lines
        const invoiceLineObjects = await this.processInvoiceLines(
          lines,
          company,
          currentHeader,
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
      this.vendorLogger.debug(
        `[STEP 6] Flushed final batch ${journalBatchNum} with ${currentBatchLines.length} lines`,
      );
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
    const lineCount = lines.length;

    this.vendorLogger.debug(
      `[VALIDATE] Starting validation for ${lineCount} lines`,
    );

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
      this.validateSubVendor(line, dimensionsMap.SubVendor, false);
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
    const linesToFilter = new Set<string>();
    const mappedData = data.map((d) => new VendorFreightRawData(d));

    // Make invoice unique per UniqueId: first UniqueId keeps the invoice, duplicates get suffix _1, _2, ...
    const normalizedInv = (inv: string) => inv?.toLowerCase().trim() ?? '';
    const invoiceToUniqueIds = new Map<string, number[]>();
    for (const line of mappedData) {
      const key = normalizedInv(line.INVOICE);
      if (!key) continue;
      let ids = invoiceToUniqueIds.get(key);
      if (!ids) {
        ids = [];
        invoiceToUniqueIds.set(key, ids);
      }
      if (!ids.includes(line.UniqueId)) ids.push(line.UniqueId);
    }
    for (const line of mappedData) {
      const key = normalizedInv(line.INVOICE);
      const uniqueIds = invoiceToUniqueIds.get(key);
      if (!uniqueIds || uniqueIds.length <= 1) continue;
      const index = uniqueIds.indexOf(line.UniqueId);
      if (index >= 1) {
        line.INVOICE = `${line.INVOICE}_${index}`;
      }
    }

    for (const line of mappedData) {
      if (line.ISLEDGER) continue;
      const isCustody = custodyAccountNumbers.includes(
        line.ACCOUNTDISPLAYVALUE,
      );
      if (isCustody) {
        linesToFilter.add(line.UniqueId.toString());
      }
    }

    return mappedData.filter((d) => !linesToFilter.has(d.UniqueId.toString()));
  }

  private sortLinesByLineNumber(
    lines: VendorFreightRawData[],
  ): VendorFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
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
    voucher: number,
    lineNumber: () => number,
  ): Promise<IVendorFreightDFOLine[]> {
    const lineObjects: IVendorFreightDFOLine[] = [];

    for (const line of invoiceLines) {
      const obj = await this.buildLine(
        line,
        header,
        company,
        line.UniqueId.toString(),
        voucher,
        lineNumber(),
      );
      lineObjects.push(obj);
    }

    return lineObjects;
  }

  private async fetchExchangeRatesForHeader(
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
      `[FILTER] Processed ${rawCount} raw records → ${filteredCount} valid records (excluded ${excluded} custody accounts)`,
    );
  }

  private logFinalStats(totalBatches: number, totalLines: number): void {
    this.vendorLogger.debug(
      `[COMPLETE] Generated ${totalLines} enriched lines across ${totalBatches} batches`,
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
    if (currency === toCurrency) return 100;

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

    return rate ?? 100;
  }

  private async buildLine(
    line: VendorFreightRawData,
    header: IVendorFreightDFOHeader,
    company: string,
    uniqueId: string,
    voucherNum: number,
    lineNumber: number,
  ): Promise<IVendorFreightDFOLine> {
    const dimensionModel = this.parseToDimensions(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const vendorInfo = line.ISVENDOR
      ? await this.getVendorTaxNumberAndTermsOfPayment(
          company,
          line.ACCOUNTDISPLAYVALUE,
        )
      : { taxNumber: '', termsOfPayment: '' };
    const termsOfPayment = vendorInfo.termsOfPayment;

    // Calculate exchange rates once per invoice
    const { exchangeRate, reportingRate } =
      await this.fetchExchangeRatesForHeader(line);

    // Normalize currency, company codes, and TransactionType
    const normalizedCurrency = this.normalizeCurrencyCode(line.CURRENCYCODE);
    const normalizedCompany = this.normalizeCompanyCode(company);
    const normalizedTransactionType = this.normalizeTransactionType('vendor');

    return new IVendorFreightDFOLine({
      header,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LineNumber: lineNumber,
      LINENUMBER: lineNumber.toString(),
      ACCOUNTTYPE: line.ACCOUNTTYPE,
      ACCOUNTDISPLAYVALUE: line.ACCOUNTDISPLAYVALUE,
      DEFAULTDIMENSIONDISPLAYVALUE: line.DEFAULTDIMENSIONDISPLAYVALUE,
      DimensionModel: dimensionModel,
      COMPANY: normalizedCompany,
      CREDIT: line.CREDITAMOUNT ?? 0,
      DEBIT: line.DEBITAMOUNT,
      CURRENCY: normalizedCurrency,
      DATE: line.TRANSDATE,
      DESCRIPTION: line.DESCRIPTION ?? line.TEXT,
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
      OFFSETCOMPANY: normalizedCompany,
      OFFSETDEFAULTDIMENSIONDISPLAYVALUE:
        line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
      OFFSETFINTAGDISPLAYVALUE: line.OFFSETFINTAGDISPLAYVALUE,
      OFFSETTRANSACTIONTEXT: line.OFFSETTEXT,
      OVERRIDESALESTAX: line.OVERRIDESALESTAX,
      PAYMID: Number(uniqueId),
      POSTINGPROFILE: line.POSTINGPROFILE,
      REPORTINGCURRENCYEXCHRATE: reportingRate,
      SALESTAXGROUP: line.SALESTAXGROUP || '',
      TAXEXEMPTNUMBER: line.TAXEXEMPTNUMBER ?? '',
      TERMSOFPAYMENT: termsOfPayment,
      TRANSACTIONTYPE: normalizedTransactionType,
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
