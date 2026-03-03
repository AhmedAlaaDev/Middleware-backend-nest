import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  DynCustodySettlementJournalEntryModel,
  CustodySettlementEntryModel,
} from '@/modules/closing/models';
import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { UpdateSettingValueCommand } from '@/modules/settings/commands/update-setting-value.command';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

interface ClosingBatchCounter {
  lastBatchNumber: number;
  companyBatchPrefix?: string;
}

interface ClosingVoucherCounter {
  lastNumber: number;
  relatedSettingLogicalName: string;
}

interface MonthGroup {
  Year: number;
  Month: number;
  Entries: DynCustodySettlementJournalEntryModel[];
}

@Injectable()
export class ClosingCustodySettlementEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType =
    EntryProcessorTypes.LedgerCustodySettlementEntry;
  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    Customer: false,
    SubCustomer: false,
    ChargeType: true,
    SalesMan: false,
    CoordinatorMan: false,
    FreightType: true,
    Direction: true,
    Vendor: false, // overridden per-line
    SubVendor: false, // overridden per-line
    Worker: false,
  };

  private readonly journalName = 'CustSettle';

  constructor(
    baseDeps: EntryProcessorBaseDependencies,
    private readonly generalJournalService: GeneralJournalService,
    private readonly commandBus: CommandBus,
  ) {
    super({ dependencies: baseDeps, rateType: 'default' });
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    _billingClassId?: string,
  ): Promise<DynDataModel[]> {
    await this.warmupProcessorData();
    const accounts = await this.getAccountCustomerInvoiceMappings(
      ServiceTypes.Freight,
    );
    const { lastBatch, lastVoucher } = await this.loadCounters(company);
    const ledgerData = this.filterAndMapLedgerData(data, accounts);
    const groupedLedger = await this.groupEntries(ledgerData);
    const dynData = this.processGroupedLedger(
      groupedLedger,
      lastVoucher,
      lastBatch,
    );
    await this.finalizeCountersAndSettings(lastBatch, lastVoucher);
    return dynData;
  }

  private async loadCounters(_company: string): Promise<{
    lastBatch: ClosingBatchCounter;
    lastVoucher: ClosingVoucherCounter;
  }> {
    const batchSetting = await this.queryBus.execute(
      new GetSettingQuery('last.ledger.batch.number'),
    );
    const voucherSetting = await this.queryBus.execute(
      new GetSettingQuery('last.ledger.custody.settlement.voucher.number'),
    );
    const lastBatchNumber = Number(batchSetting?.value ?? '0');
    const lastNumber = Number(voucherSetting?.value ?? '0');
    return {
      lastBatch: { lastBatchNumber, companyBatchPrefix: 'Mesco' },
      lastVoucher: {
        lastNumber,
        relatedSettingLogicalName:
          'last.ledger.custody.settlement.voucher.number',
      },
    };
  }

  private processGroupedLedger(
    groupedLedger: MonthGroup[],
    lastVoucher: ClosingVoucherCounter,
    lastBatch: ClosingBatchCounter,
  ): DynCustodySettlementJournalEntryModel[] {
    const dynData: DynCustodySettlementJournalEntryModel[] = [];
    for (const ledgerMonth of groupedLedger) {
      const entries = [...ledgerMonth.Entries];
      this.matchVouchersToEntryPairs(entries, lastVoucher);
      this.applyBatchNumbersAndAggregate(entries, lastBatch, dynData);
    }
    return dynData;
  }

  private async finalizeCountersAndSettings(
    lastBatch: ClosingBatchCounter,
    lastVoucher: ClosingVoucherCounter,
  ): Promise<void> {
    await this.commandBus.execute(
      new UpdateSettingValueCommand(
        lastVoucher.relatedSettingLogicalName,
        lastVoucher.lastNumber.toString(),
      ),
    );
    await this.commandBus.execute(
      new UpdateSettingValueCommand(
        'last.ledger.batch.number',
        lastBatch.lastBatchNumber.toString(),
      ),
    );
  }

  async validateAsync(
    data: DynDataModel[],
    _company: string,
    _billingClassId?: string,
  ): Promise<DynDataModel[]> {
    await Promise.resolve();
    const arData = data as DynCustodySettlementJournalEntryModel[];

    for (const arLine of arData) {
      this.validateDimensionsForLine(arLine, {
        dimensionIsRequired: {
          MainAccount: arLine.AccountType === 'Ledger',
          Vendor: arLine.AccountType === 'Vend',
          SubVendor: arLine.AccountType === 'Vend',
        },
      });
    }

    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    const batches = (data as DynCustodySettlementJournalEntryModel[]).reduce(
      (acc, entry) => {
        const batchNum = entry.JournalBatchNumber;
        if (!acc[batchNum]) {
          acc[batchNum] = [];
        }
        acc[batchNum].push(entry);
        return acc;
      },
      {} as Record<string, DynCustodySettlementJournalEntryModel[]>,
    );

    for (const [journalBatchNumber, entries] of Object.entries(batches)) {
      if (entries.length === 0) continue;

      await this.generalJournalService.createJournalHeader(company, entries[0]);

      for (const entry of entries) {
        const lineResponse = await this.generalJournalService.createJournalLine(
          company,
          entry,
        );
        if (!lineResponse) {
          throw new Error(
            `Failed to create journal line for batch ${journalBatchNumber}.`,
          );
        }
      }
    }
  }

  private async createJournalEntryDto(
    lineNumber: number,
    batchNumber: string,
    voucherNumber: string,
    source: CustodySettlementEntryModel,
    dimensionsModel: EntryDimensionsModel,
  ): Promise<DynCustodySettlementJournalEntryModel> {
    await Promise.resolve();
    const transDate = new Date(source.TRANSDATE);
    const { exchangeRate, reportingRate } = this.fetchExchangeRates(
      String(source.TRANSDATE),
      source.CURRENCYCODE || '',
    );

    const sourceJournalName = source?.JOURNALNAME?.trim()?.toLowerCase() || '';
    const descriptionSuffix =
      sourceJournalName === 'cashin'
        ? 'Cash In'
        : sourceJournalName === 'cashout'
          ? 'Cash Out'
          : 'Without Cash';
    const monthYearLabel = this.utilsService.formatMonthYear(
      String(source.TRANSDATE),
    );

    const line = new DynCustodySettlementJournalEntryModel();
    line.CustomId = parseInt(
      `${source.UniqueId}${dimensionsModel.costCenter || ''}`,
      10,
    );
    line.UniqueId = source.UniqueId;
    line.LineNumber = lineNumber;
    line.JournalBatchNumber = batchNumber;
    line.JournalName = this.journalName;
    line.Description = `Custody Settlement Entry ${monthYearLabel} (${descriptionSuffix})`;
    line.Voucher = voucherNumber;
    line.DimensionModel = dimensionsModel;
    line.TransDate = transDate;
    line.AccountDisplayValue = source.ACCOUNTDISPLAYVALUE || '';
    line.AccountType = source.ACCOUNTTYPE || '';
    line.OffsetAccountType = source.OFFSETACCOUNTTYPE || '';
    line.OffsetAccountDisplayValue = source.OFFSETACCOUNTDISPLAYVALUE || '';
    line.OffsetDefaultDimensionDisplayValue =
      source.OFFSETDEFAULTDIMENSIONDISPLAYVALUE || '';
    line.DebitAmount = source.DEBITAMOUNT || 0;
    line.CreditAmount = source.CREDITAMOUNT || 0;
    line.CurrencyCode = source.CURRENCYCODE || '';
    line.ExchangeRate = exchangeRate;
    line.ReportingCurrencyExchRate = reportingRate;
    line.ReportingCurrencyExchRateSecondary = 0;
    line.CashDiscount = source.CASHDISCOUNT || '';
    line.CashDiscountAmount = source.CASHDISCOUNTAMOUNT || 0;
    line.CashDiscountDate = source.CASHDISCOUNTDATE;
    line.Document = source.DOCUMENT || '';
    line.DocumentDate = source.DOCUMENTDATE;
    line.DueDate = source.DOCUMENTDATE;
    line.ItemSalesTaxGroup = source.getTaxGroupItem();
    line.SalesTaxGroup = source.getTaxGroup();
    line.FinTagDisplayValue = source.FINTAGDISPLAYVALUE || '';
    line.OffsetFinTagDisplayValue = source.OFFSETFINTAGDISPLAYVALUE || '';
    line.DefaultDimensionDisplayValue =
      source.DEFAULTDIMENSIONDISPLAYVALUE || '';
    line.OffsetText = source.OFFSETTEXT || '';
    line.OverrideSalesTax = source.OVERRIDESALESTAX || '';
    line.PaymentId = source.PAYMENTID || '';
    line.PaymentMethod = source.PAYMENTMETHOD || '';
    line.PaymentReference = source.PAYMENTREFERENCE || '';
    line.Prepayment = source.PREPAYMENT || '';
    line.PostingLayer = source.POSTINGLAYER || '';
    line.PostingProfile = source.POSTINGPROFILE || '';
    line.ReverseDate = source.REVERSEDATE;
    line.ReverseEntry = source.REVERSEENTRY || '';
    line.TaxExemptNumber = source.TAXEXEMPTNUMBER || '';
    line.Text = source.TEXT || '';
    line.Quantity = source.QUANTITY || 0;
    line.Invoice = source.DOCUMENT || '';
    line.IsPosted = 'No';
    line.SourceIds = [source.UniqueId.toString()];

    if (
      typeof source.dimensionSegmentLength === 'number' &&
      !this.utilsService.isValidDimensionSegmentLength(
        source.dimensionSegmentLength,
      )
    ) {
      line.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${source.dimensionSegmentLength}. Expected 19 or 20 segments.`,
      );
    }

    return line;
  }

  private filterAndMapLedgerData(
    data: RawDataModel[],
    invoiceMappings: any[],
  ): CustodySettlementEntryModel[] {
    const excludedEntries: string[] = [];
    const ledgerData: CustodySettlementEntryModel[] = [];

    for (const entry of data) {
      const ledgerEntry = new CustodySettlementEntryModel();
      Object.assign(ledgerEntry, entry);

      const rawDimensionString =
        ledgerEntry.ACCOUNTTYPE === 'Ledger'
          ? ledgerEntry.ACCOUNTDISPLAYVALUE || ''
          : ledgerEntry.DEFAULTDIMENSIONDISPLAYVALUE || '';

      ledgerEntry.dimensionSegmentLength =
        this.utilsService.getDimensionSegmentLength(rawDimensionString);

      ledgerEntry.AccountDimensions =
        this.utilsService.parseDimensionString(rawDimensionString);

      if (
        invoiceMappings.some((a: any) =>
          a.customerAccount
            ?.toLowerCase()
            .includes(
              ledgerEntry.AccountDimensions?.customer?.toLowerCase() || '',
            ),
        )
      ) {
        const mappingAccount = invoiceMappings.find((a: any) =>
          a.customerAccount
            ?.toLowerCase()
            .includes(
              ledgerEntry.AccountDimensions?.subCustomer?.toLowerCase() || '',
            ),
        );
        if (mappingAccount) {
          ledgerEntry.AccountDimensions.subCustomer =
            mappingAccount.invoiceAccount;
        }
      }

      ledgerEntry.ACCOUNTDISPLAYVALUE = entry.ACCOUNTDISPLAYVALUE || '';

      if (
        !excludedEntries.some(
          (c) => c === ledgerEntry.AccountDimensions?.costCenter,
        )
      ) {
        ledgerData.push(ledgerEntry);
      }
    }

    return ledgerData.sort((a, b) => a.getLineNumber() - b.getLineNumber());
  }

  private async groupEntries(
    ledgerData: CustodySettlementEntryModel[],
  ): Promise<MonthGroup[]> {
    const monthGroups: Record<string, MonthGroup> = {};

    for (const entry of ledgerData) {
      const date = new Date(entry.TRANSDATE);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;

      if (!monthGroups[key]) {
        monthGroups[key] = {
          Year: year,
          Month: month,
          Entries: [],
        };
      }

      const journalEntry = await this.createJournalEntryDto(
        entry.getLineNumber(),
        '0',
        '',
        entry,
        entry.AccountDimensions!,
      );
      monthGroups[key].Entries.push(journalEntry);
    }

    // Sort entries within each month - preserve source LineNumber order
    // so debit/credit pairs stay consecutive (line 1–2, 3–4, etc.)
    Object.values(monthGroups).forEach((monthGroup) => {
      monthGroup.Entries.sort((a, b) => {
        if (a.TransDate.getTime() !== b.TransDate.getTime()) {
          return a.TransDate.getTime() - b.TransDate.getTime();
        }
        // Preserve source line order for correct debit/credit pairing
        if (a.LineNumber !== b.LineNumber) {
          return (a.LineNumber || 0) - (b.LineNumber || 0);
        }
        if (a.UniqueId !== b.UniqueId) {
          return (a.UniqueId || 0) - (b.UniqueId || 0);
        }
        const aCostCenter = a.DimensionModel?.costCenter || '';
        const bCostCenter = b.DimensionModel?.costCenter || '';
        if (aCostCenter !== bCostCenter) {
          return aCostCenter.localeCompare(bCostCenter);
        }
        if (a.DebitAmount !== b.DebitAmount) {
          return a.DebitAmount - b.DebitAmount;
        }
        return a.CreditAmount - b.CreditAmount;
      });
    });

    return Object.values(monthGroups).sort((a, b) => {
      if (a.Year !== b.Year) {
        return a.Year - b.Year;
      }
      return a.Month - b.Month;
    });
  }

  private matchVouchersToEntryPairs(
    entries: DynCustodySettlementJournalEntryModel[],
    lastVoucher: ClosingVoucherCounter,
  ): void {
    const groups = entries
      .filter((e) => !e.Voucher)
      .reduce(
        (acc, entry) => {
          const sourceId = entry.SourceIds[0] || '';
          if (!acc[sourceId]) {
            acc[sourceId] = [];
          }
          acc[sourceId].push(entry);
          return acc;
        },
        {} as Record<string, DynCustodySettlementJournalEntryModel[]>,
      );

    for (const group of Object.values(groups)) {
      lastVoucher.lastNumber += 1;
      const voucher = lastVoucher.lastNumber;

      for (const entry of group) {
        entry.Voucher = this.utilsService.formatVoucherNumber(
          voucher,
          this.journalName,
        );
      }
    }
  }

  private applyBatchNumbersAndAggregate(
    entries: DynCustodySettlementJournalEntryModel[],
    lastBatch: ClosingBatchCounter,
    dynData: DynCustodySettlementJournalEntryModel[],
  ): void {
    lastBatch.lastBatchNumber += 1;
    let batchLineNumber = 1;

    const vouchers = entries.reduce(
      (acc, entry) => {
        const voucher = entry.Voucher;
        if (!acc[voucher]) {
          acc[voucher] = [];
        }
        acc[voucher].push(entry);
        return acc;
      },
      {} as Record<string, DynCustodySettlementJournalEntryModel[]>,
    );

    for (const voucherEntries of Object.values(vouchers)) {
      if (batchLineNumber + voucherEntries.length > 1000) {
        lastBatch.lastBatchNumber += 1;
        batchLineNumber = 1;
      }

      for (const entry of voucherEntries) {
        entry.LineNumber = batchLineNumber++;
        entry.JournalBatchNumber = this.utilsService.formatBatchNumber(
          lastBatch.lastBatchNumber,
        );
        dynData.push(entry);
      }
    }
  }
}
