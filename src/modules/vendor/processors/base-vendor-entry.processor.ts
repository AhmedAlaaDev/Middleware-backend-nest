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
export abstract class BaseVendorEntryProcessor extends EntryProcessorBase {
  protected readonly logger = new Logger(BaseVendorEntryProcessor.name);

  protected readonly MAX_LINES_PER_BATCH = 1000;

  abstract readonly entryProcessorType: EntryProcessorTypes;
  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  protected abstract getJournalName(): string;
  protected abstract getDescriptionPrefix(): string;

  constructor(
    protected readonly commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super({ dependencies: baseDeps });
  }

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

    const rawLines = this.mapToModel(data);
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    const sortedLines = this.sortRawDataByLineNumber(rawLines);
    const updatedLines = this.utilsService.suffixDuplicateInvoices(sortedLines);

    const custodyAccountNumbers = await this.getCustodyAccountNumbers(company);
    const { custodySettlementLines, otherLines } = this.filterLines(
      updatedLines,
      custodyAccountNumbers,
    );
    this.logger.debug(
      `[FILTER] Processed ${updatedLines.length} lines → ${custodySettlementLines.length} custody settlement, ${otherLines.length} other lines`,
    );

    this.processCustodySettlementLines(custodySettlementLines);

    const invoiceMap = this.buildUniqueIdMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.logger.debug(`[STEP 3] Found ${invoiceCount} invoices`);

    this.checkInvoiceBalancedAfterFx(invoiceMap);

    if (this.unbalancedUniqueIds.size > 0) {
      this.logger.error(
        `[STEP 3.5] Found ${this.unbalancedUniqueIds.size} unbalanced invoices after FX`,
      );
    }

    const dfoLines = this.buildInvoiceLines(invoiceMap);

    const updatedDfoLines = this.utilsService.updateBatchAndVoucher({
      lines: dfoLines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
      maxLinesPerBatch: this.MAX_LINES_PER_BATCH,
    });

    return updatedDfoLines.map(
      (line) => new VendorEntryDynDataModel(line.DimensionModel, line),
    );
  }

  public validateAsync(
    data: EntryDynDataModel[],
    _company?: string,
  ): EntryDynDataModel[] {
    const lines = data as unknown as VendorEntryDynDataModel[];
    this.logger.debug(
      `[VALIDATE] Starting validation for ${lines.length} lines`,
    );

    for (const line of lines) {
      this.validateDimensionsForLine(line);
    }

    return data;
  }

  public insertIntoDynamicsAsync(
    _data: EntryDynDataModel[],
    _company: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  protected mapToModel(data: EntryRawDataModel[]): VendorEntryRawDataModel[] {
    return data.map((d) => new VendorEntryRawDataModel(d));
  }

  protected async getCustodyAccountNumbers(company: string): Promise<string[]> {
    const custodyVendorsRes = await this.queryBus.execute(
      new GetVendorsQuery({ company, vendorGroupIds: ['Custody'] }),
    );
    return (custodyVendorsRes?.items ?? []).map((v) => v.vendorAccountNumber);
  }

  protected filterLines(
    data: VendorEntryRawDataModel[],
    custodyAccountNumbers: string[],
  ): {
    custodySettlementLines: VendorEntryRawDataModel[];
    otherLines: VendorEntryRawDataModel[];
  } {
    const custodyUniqueIds = new Set<string>();

    for (const line of data) {
      if (this.isLedger(line)) continue;
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

  protected processCustodySettlementLines(
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

  protected buildInvoiceLines(
    invoiceMap: Map<string, VendorEntryRawDataModel[]>,
  ): VendorEntryDynDataModel[] {
    const dfoLines: VendorEntryDynDataModel[] = [];

    for (const [sourceId, lines] of invoiceMap.entries()) {
      dfoLines.push(...this.buildLines(sourceId, lines));
    }

    return dfoLines;
  }

  protected buildLines(
    sourceId: string,
    lines: VendorEntryRawDataModel[],
  ): VendorEntryDynDataModel[] {
    return lines.map((line) => this.buildLine(sourceId, line));
  }

  protected buildLine(
    sourceId: string,
    line: VendorEntryRawDataModel,
  ): VendorEntryDynDataModel {
    const dimensions = this.utilsService.parseDimensionString(
      this.isLedger(line)
        ? line.ACCOUNTDISPLAYVALUE
        : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const vendorInfo = this.isVendor(line)
      ? this.getVendorTaxNumberAndTermsOfPayment(line.ACCOUNTDISPLAYVALUE)
      : { taxNumber: '', termsOfPayment: '' };
    const termsOfPayment = vendorInfo.termsOfPayment;

    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      line.TRANSDATE,
      line.CURRENCYCODE,
    );

    const normalizedCurrency = this.utilsService.normalizeCurrencyCode(
      line.CURRENCYCODE,
    );

    const isWithholding =
      String(line.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
      'yes';

    return new VendorEntryDynDataModel(dimensions, {
      dataAreaId: this.company,
      Description: `${this.getDescriptionPrefix()} ${this.utilsService.formatMonthYear(line.TRANSDATE)}`,
      JournalName: this.getJournalName(),
      JournalBatchNumber: line.JOURNALBATCHNUMBER,
      LineNumber: Number(line.LINENUMBER),
      AccountType: line.ACCOUNTTYPE as 'Vend' | 'Ledger',
      AccountDisplayValue: line.ACCOUNTDISPLAYVALUE,
      DefaultDimensionDisplayValue: line.DEFAULTDIMENSIONDISPLAYVALUE ?? '',
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
      IsWithholdingTaxCalculate: isWithholding ? 'Yes' : 'No',
      ItemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
      ItemWithholdingTaxGroupCode: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
      MethodOfPayment: line.PAYMENTMETHOD,
      PaymId: sourceId,
      PostingProfile: line.POSTINGPROFILE,
      ReportingCurrencyExchRate: reportingRate,
      SalesTaxGroup: line.SALESTAXGROUP || '',
      TaxExemptNumber:
        line.TAXEXEMPTNUMBER != null ? String(line.TAXEXEMPTNUMBER) : undefined,
      TermsOfPayment: termsOfPayment,
      Voucher: line?.VOUCHER,
      SourceIds: [sourceId],
    });
  }

  protected isLedger(line: VendorEntryRawDataModel): boolean {
    const t = (line as { ACCOUNTTYPE?: string }).ACCOUNTTYPE;
    return (
      String(t ?? '')
        .toLowerCase()
        .trim() === 'ledger'
    );
  }

  protected isVendor(line: VendorEntryRawDataModel): boolean {
    const t = (line as { ACCOUNTTYPE?: string }).ACCOUNTTYPE;
    return (
      String(t ?? '')
        .toLowerCase()
        .trim() === 'vend'
    );
  }
}
