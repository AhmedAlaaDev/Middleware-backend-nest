import { Injectable, Logger } from '@nestjs/common';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  RawDataModel,
  DynDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { GetVendorsQuery } from '@/modules/master-data/queries';
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
  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    ChargeType: true,
    SalesMan: true,
    CoordinatorMan: true,
    FreightType: true,
    Direction: true,
    TruckerType: true,
    TruckNumber: true, // overridden per-line (required when truckerType 11 or 12)
    Vendor: true,
    SubVendor: false,
    Worker: true,
  };

  constructor(baseDeps: EntryProcessorBaseDependencies) {
    super({ dependencies: baseDeps });
  }

  // --------------------------------------------------------------------------
  // FORMAT & ENRICH
  // --------------------------------------------------------------------------
  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    await this.warmupProcessorData();
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
    const eData: IVendorTruckingAdjustmentDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorTruckingAdjustmentDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorTruckingAdjustmentDFOHeader | null = null;
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

        // Calculate exchange rates once per invoice
        const { exchangeRate, reportingRate } = this.fetchExchangeRates(
          headerLine.TRANSDATE,
          headerLine.CURRENCYCODE,
        );

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
    await Promise.resolve();
    const lines = data as unknown as IVendorTruckingAdjustmentDFOLine[];
    const lineCount = lines.length;

    this.vendorLogger.debug(
      `[VALIDATE] Starting validation for ${lineCount} lines`,
    );

    for (const line of lines) {
      const truckerType = line.DimensionModel?.truckerType;
      const requireTruckNumber = truckerType === '11' || truckerType === '12';

      this.validateDimensionsForLine(line, {
        dimensionIsRequired: {
          TruckNumber: requireTruckNumber,
        },
      });
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

  private sortLinesByLineNumber(
    lines: VendorTruckingAdjustmentRawData[],
  ): VendorTruckingAdjustmentRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private sortLinesByMonthAndInvoice(
    lines: VendorTruckingAdjustmentRawData[],
  ): VendorTruckingAdjustmentRawData[] {
    const sorted = [...lines].sort((a, b) => {
      let monthA: string;
      let monthB: string;

      try {
        monthA = this.utilsService.toMonthKey(a.TRANSDATE);
      } catch (_error) {
        monthA = 'invalid-date';
      }

      try {
        monthB = this.utilsService.toMonthKey(b.TRANSDATE);
      } catch (_error) {
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
    sortedLines: VendorTruckingAdjustmentRawData[],
  ): Map<string, Map<string, VendorTruckingAdjustmentRawData[]>> {
    const monthInvoiceMap = new Map<
      string,
      Map<string, VendorTruckingAdjustmentRawData[]>
    >();

    for (const line of sortedLines) {
      let monthKey: string;

      try {
        monthKey = this.utilsService.toMonthKey(line.TRANSDATE);
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
        monthKey = this.utilsService.toMonthKey(line.TRANSDATE);
      } catch (_error) {
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
    headerLine: VendorTruckingAdjustmentRawData,
    journalBatchNum: number,
  ): IVendorTruckingAdjustmentDFOHeader {
    const formattedDate = this.utilsService.formatMonthYear(
      headerLine.TRANSDATE,
    );

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

    eData.push(...batchLines);
  }

  private async processInvoiceLines(
    invoiceLines: VendorTruckingAdjustmentRawData[],
    company: string,
    header: IVendorTruckingAdjustmentDFOHeader,
    exchangeRate: number,
    reportingRate: number,
    voucher: number,
    lineNumber: () => number,
  ): Promise<IVendorTruckingAdjustmentDFOLine[]> {
    const lineObjects: IVendorTruckingAdjustmentDFOLine[] = [];

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

  private createBatchHeader(
    headerLine: VendorTruckingAdjustmentRawData,
    journalBatchNum: number,
    formattedDate: string,
  ): IVendorTruckingAdjustmentDFOHeader {
    return new IVendorTruckingAdjustmentDFOHeader({
      JOURNALBATCHNUMBER: this.utilsService.formatBatchNumber(journalBatchNum),
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

  private async buildLine(
    line: VendorTruckingAdjustmentRawData,
    header: IVendorTruckingAdjustmentDFOHeader,
    company: string,
    exchangeRate: number,
    reportingRate: number,
    uniqueId: string,
    voucherNum: number,
    lineNumber: number,
  ): Promise<IVendorTruckingAdjustmentDFOLine> {
    const dimensionModel = this.utilsService.parseDimensionString(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const { taxNumber: _tax, termsOfPayment } = line.ISVENDOR
      ? await this.getVendorTaxNumberAndTermsOfPayment(
          company,
          line.ACCOUNTDISPLAYVALUE,
        )
      : { taxNumber: '', termsOfPayment: '' };

    // Normalize currency, company codes, and TransactionType
    const normalizedCurrency = this.utilsService.normalizeCurrencyCode(
      line.CURRENCYCODE,
    );
    const normalizedCompany = this.utilsService.normalizeCompanyCode(company);
    const normalizedTransactionType =
      this.utilsService.normalizeTransactionType('vendor');

    return new IVendorTruckingAdjustmentDFOLine({
      header,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LineNumber: lineNumber,
      ACCOUNTTYPE: line.ACCOUNTTYPE,
      ACCOUNTDISPLAYVALUE: line.ACCOUNTDISPLAYVALUE,
      DEFAULTDIMENSIONDISPLAYVALUE: line.DEFAULTDIMENSIONDISPLAYVALUE,
      DimensionModel: dimensionModel,
      COMPANY: normalizedCompany,
      CREDIT: line.CREDITAMOUNT ?? 0,
      DEBIT: line.DEBITAMOUNT,
      CURRENCY: normalizedCurrency,
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
      ITEMWITHHOLDINGTAXGROUPCODE: '',
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
      TAXEXEMPTNUMBER: '',
      TERMSOFPAYMENT: termsOfPayment,
      TRANSACTIONTYPE: normalizedTransactionType,
      VOUCHER: this.utilsService.formatVoucherNumber(
        voucherNum,
        line.JOURNALNAME,
      ),
      SourceIds: [uniqueId],
    });
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}
