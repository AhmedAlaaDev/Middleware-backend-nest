import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  RawDataModel,
  DynDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';
import { GetVendorsQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';
import {
  IVendorTruckingDFOHeader,
  IVendorTruckingDFOLine,
} from '@/modules/vendor/interfaces/vendor-trucking-dfo-data.interface';
import { VendorTruckingRawData } from '@/modules/vendor/models/vendor-trucking-raw-data.model';

@Injectable()
export class VendorTruckingEntryProcessor extends EntryProcessorBase {
  private readonly vendorLogger = new Logger(VendorTruckingEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------
  readonly entryProcessorType = EntryProcessorTypes.VendorTrucking;
  private readonly MAX_LINES_PER_BATCH = 1000;
  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Customer: true,
    SubCustomer: false,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    ChargeType: true,
    SalesMan: true,
    CoordinatorMan: true,
    Direction: true,
    TruckerType: true, // overridden per-line (required only for Ledger)
    Vendor: true,
    SubVendor: false,
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
    this.vendorLogger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Split custody settlement vs other lines
    this.vendorLogger.debug(
      `[STEP 1] Fetching custody account numbers for company: ${company}`,
    );
    const custodyAccountNumbers = await this.getCustodyAccountNumbers(company);
    this.vendorLogger.debug(
      `[STEP 1] Found ${custodyAccountNumbers.length} custody accounts`,
    );
    const { custodySettlementLines, otherLines } = this.filterRawData(
      data,
      custodyAccountNumbers,
    );
    this.logInitialStats(
      rawCount,
      custodySettlementLines.length,
      otherLines.length,
    );

    // STEP 1.5: Run custody settlement with raw data (no file – already extracted from Excel)
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
          this.vendorLogger.error(
            `Error processing custody settlement entry: ${error}`,
          );
        });
    }

    // STEP 2: Sort by month and invoice
    const sortedLines = this.sortLinesByLineNumber(otherLines);
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
    const eData: IVendorTruckingDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: IVendorTruckingDFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: IVendorTruckingDFOHeader | null = null;
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
    const lines = data as unknown as IVendorTruckingDFOLine[];
    const lineCount = lines.length;

    this.vendorLogger.debug(
      `[VALIDATE] Starting validation for ${lineCount} lines`,
    );

    for (const line of lines) {
      await this.validateDimensionsForLine(line, {
        validateMainAccount: line.ACCOUNTTYPE === 'Ledger',
        dimensionIsRequired: {
          TruckerType: line.ACCOUNTTYPE === 'Ledger',
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
  ): {
    custodySettlementLines: VendorTruckingRawData[];
    otherLines: VendorTruckingRawData[];
  } {
    const custodyUniqueIds = new Set<string>();
    const mappedData = data.map((d) => new VendorTruckingRawData(d));

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
        custodyUniqueIds.add(line.UniqueId.toString());
      }
    }

    const custodySettlementLines = mappedData.filter((d) =>
      custodyUniqueIds.has(d.UniqueId.toString()),
    );
    const otherLines = mappedData.filter(
      (d) => !custodyUniqueIds.has(d.UniqueId.toString()),
    );

    return { custodySettlementLines, otherLines };
  }

  private sortLinesByLineNumber(
    lines: VendorTruckingRawData[],
  ): VendorTruckingRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private buildVoucherMap(
    sortedLines: VendorTruckingRawData[],
  ): Map<string, Map<string, VendorTruckingRawData[]>> {
    const monthInvoiceMap = new Map<
      string,
      Map<string, VendorTruckingRawData[]>
    >();

    for (const line of sortedLines) {
      let monthKey: string;

      try {
        monthKey = this.toMonthKey(line.TRANSDATE);
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
    headerLine: VendorTruckingRawData,
    journalBatchNum: number,
  ): IVendorTruckingDFOHeader {
    const formattedDate = this.formatMonthYear(headerLine.TRANSDATE);

    const header = this.createBatchHeader(
      headerLine,
      journalBatchNum,
      formattedDate,
    );

    return header;
  }

  private flushBatch(
    header: IVendorTruckingDFOHeader,
    batchLines: IVendorTruckingDFOLine[],
    eData: IVendorTruckingDFOLine[],
  ): void {
    if (batchLines.length === 0) {
      return;
    }

    eData.push(...batchLines);
  }

  private async processInvoiceLines(
    invoiceLines: VendorTruckingRawData[],
    company: string,
    header: IVendorTruckingDFOHeader,
    voucher: number,
    lineNumber: () => number,
  ): Promise<IVendorTruckingDFOLine[]> {
    const lineObjects: IVendorTruckingDFOLine[] = [];

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

  private createBatchHeader(
    headerLine: VendorTruckingRawData,
    journalBatchNum: number,
    formattedDate: string,
  ): IVendorTruckingDFOHeader {
    return new IVendorTruckingDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      DESCRIPTION: `Vendor Invoice Fleet ${formattedDate}`,
      JOURNALNAME: headerLine.JOURNALNAME,
      ISPOSTED: headerLine.ISPOSTED,
      JOURNALTOTALCREDIT: 0,
      JOURNALTOTALDEBIT: 0,
      OVERSIDESALESTAX: false,
      SALESTAXINCLUDED: true,
    });
  }

  private logInitialStats(
    rawCount: number,
    custodyCount: number,
    otherCount: number,
  ): void {
    this.vendorLogger.debug(
      `[FILTER] Processed ${rawCount} raw records → ${custodyCount} custody settlement lines, ${otherCount} other lines`,
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
    line: VendorTruckingRawData,
    header: IVendorTruckingDFOHeader,
    company: string,
    uniqueId: string,
    voucherNum: number,
    lineNumber: number,
  ): Promise<IVendorTruckingDFOLine> {
    const dimensionModel = this.parseDimensionString(
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
    const { exchangeRate, reportingRate } = await this.fetchExchangeRates(
      line.TRANSDATE,
      line.CURRENCYCODE,
    );

    // Normalize currency, company codes, and TransactionType
    const normalizedCurrency = this.normalizeCurrencyCode(line.CURRENCYCODE);
    const normalizedCompany = this.normalizeCompanyCode(company);
    const normalizedTransactionType = this.normalizeTransactionType('vendor');

    return new IVendorTruckingDFOLine({
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
      DESCRIPTION: (line as { DESCRIPTION?: string }).DESCRIPTION ?? line.TEXT,
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
      ITEMWITHHOLDINGTAXGROUPCODE:
        (line as { ITEMWITHHOLDINGTAXGROUPCODE?: string })
          ?.ITEMWITHHOLDINGTAXGROUPCODE || '',
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

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}
