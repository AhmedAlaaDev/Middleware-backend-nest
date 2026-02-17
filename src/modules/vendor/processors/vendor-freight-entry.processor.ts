import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { ProcessCustodySettlementEntryCommand } from '@/modules/closing/commands';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { GetVendorsQuery } from '@/modules/master-data/queries';
import {
  VendorEntryDynDataModel,
  VendorEntryRawDataModel,
} from '@/modules/vendor/models';

@Injectable()
export class VendorFreightEntryProcessor extends EntryProcessorBase {
  private readonly logger = new Logger(VendorFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------
  readonly entryProcessorType = EntryProcessorTypes.VendorFreight;
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
    FreightType: true,
    CoordinatorMan: true,
    Direction: true,
    Vendor: true,
    SubVendor: false,
  };

  private readonly JOURNAL_NAME = 'V-Freight';

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

    await this.warmupProcessorData({
      vendorTaxNumberAndTermsOfPayment: true,
    });

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

    // STEP 1.6: Suffix duplicate invoices
    this.logger.debug(
      `[STEP 1.6] Suffixing duplicate invoices from ${sortedLines.length} lines`,
    );
    const updatedLines = this.utilsService.suffixDuplicateInvoices(sortedLines);
    this.logger.debug(`[STEP 1.6] Suffixed to ${updatedLines.length} lines`);

    // STEP 2: FILTER CUSTODY SETTLEMENTS
    this.logger.debug(
      `[STEP 2] Filtering custody settlements from ${sortedLines.length} lines`,
    );
    const custodyAccountNumbers = await this.getCustodyAccountNumbers(company);
    const { custodySettlementLines, otherLines } = this.filterLines(
      sortedLines,
      custodyAccountNumbers,
    );
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

    return updatedDfoLines.map(
      (line) => new VendorEntryDynDataModel(line.DimensionModel, line),
    );
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public validateAsync(data: EntryDynDataModel[]): EntryDynDataModel[] {
    const lines = data as unknown as VendorEntryDynDataModel[];
    const lineCount = lines.length;

    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      this.validateDimensionsForLine(line);
    }

    return data;
  }

  private mapToModel(
    data: VendorEntryRawDataModel[],
  ): VendorEntryRawDataModel[] {
    return data.map((d) => new VendorEntryRawDataModel(d));
  }

  private async getCustodyAccountNumbers(company: string): Promise<string[]> {
    const custodyVendorsRes = await this.queryBus.execute(
      new GetVendorsQuery({ company, vendorGroupIds: ['Custody'] }),
    );
    return (custodyVendorsRes?.items ?? []).map((v) => v.vendorAccountNumber);
  }

  private filterLines(
    data: VendorEntryRawDataModel[],
    custodyAccountNumbers: string[],
  ): {
    custodySettlementLines: VendorEntryRawDataModel[];
    otherLines: VendorEntryRawDataModel[];
  } {
    const custodyUniqueIds = new Set<string>();

    for (const line of data) {
      if (line.ISLEDGER) continue;
      const isCustody = custodyAccountNumbers.includes(
        line.ACCOUNTDISPLAYVALUE,
      );
      if (isCustody) {
        custodyUniqueIds.add(line.UniqueId.toString());
      }
    }

    const custodySettlementLines = data.filter((d) =>
      custodyUniqueIds.has(d.UniqueId.toString()),
    );

    const otherLines = data.filter(
      (d) => !custodyUniqueIds.has(d.UniqueId.toString()),
    );

    return { custodySettlementLines, otherLines };
  }

  private processCustodySettlementLines(
    lines: VendorEntryRawDataModel[],
  ): void {
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
    invoiceMap: Map<string, VendorEntryRawDataModel[]>,
  ): VendorEntryDynDataModel[] {
    const dfoLines: VendorEntryDynDataModel[] = [];

    for (const [sourceId, lines] of invoiceMap.entries()) {
      dfoLines.push(...this.buildLines(sourceId, lines));
    }

    return dfoLines;
  }

  private buildLines(
    sourceId: string,
    lines: VendorEntryRawDataModel[],
  ): VendorEntryDynDataModel[] {
    return lines.map((line) => this.buildLine(sourceId, line));
  }

  private buildLine(
    sourceId: string,
    line: VendorEntryRawDataModel,
  ): VendorEntryDynDataModel {
    const dimensions = this.utilsService.parseDimensionString(
      line.ISLEDGER
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const vendorInfo = line.ISVENDOR
      ? this.getVendorTaxNumberAndTermsOfPayment(line.ACCOUNTDISPLAYVALUE)
      : { taxNumber: '', termsOfPayment: '' };
    const termsOfPayment = vendorInfo.termsOfPayment;

    // Calculate exchange rates once per invoice
    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      line.TRANSDATE,
      line.CURRENCYCODE,
    );

    // Normalize currency, company codes, and TransactionType
    const normalizedCurrency = this.utilsService.normalizeCurrencyCode(
      line.CURRENCYCODE,
    );

    return new VendorEntryDynDataModel(dimensions, {
      dataAreaId: this.company,
      Description: `Vendor Invoice Freight ${this.utilsService.formatMonthYear(line.TRANSDATE)}`,
      JournalName: this.JOURNAL_NAME,
      JournalBatchNumber: line.JOURNALBATCHNUMBER,
      LineNumber: line.LINENUMBER,
      AccountType: line.ACCOUNTTYPE,
      AccountDisplayValue: line.ACCOUNTDISPLAYVALUE,
      DefaultDimensionDisplayValue: line.DEFAULTDIMENSIONDISPLAYVALUE,
      Company: this.company,
      Credit: line.CREDITAMOUNT ?? 0,
      Debit: line.DEBITAMOUNT,
      Currency: normalizedCurrency,
      Date: line.TRANSDATE,
      Document: line.DOCUMENT,
      DueDate: line.DUEDATE,
      ExchRate: exchangeRate,
      FinTagDisplayValue: line.FINTAGDISPLAYVALUE,
      Invoice: line.INVOICE,
      InvoiceDate: line.DOCUMENTDATE,
      IsWithholdingTaxCalculate: line.ISWITHHOLDINGCALCULATIONENABLED
        ? 'Yes'
        : 'No',
      ItemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
      ItemWithholdingTaxGroupCode: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
      MethodOfPayment: line.PAYMENTMETHOD,
      PaymId: sourceId,
      PostingProfile: line.POSTINGPROFILE,
      ReportingCurrencyExchRate: reportingRate,
      SalesTaxGroup: line.SALESTAXGROUP || '',
      TaxExemptNumber: line?.TAXEXEMPTNUMBER?.toString(),
      TermsOfPayment: termsOfPayment,
      Voucher: line?.VOUCHER,
      SourceIds: [sourceId],
    });
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}
