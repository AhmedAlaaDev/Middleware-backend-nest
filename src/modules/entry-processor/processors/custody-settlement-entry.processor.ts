import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear } from '@/lib/utils';
import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { CustodySettlementEntryModel } from '@/modules/entry-processor/models/custody-settlement-entry.model';
import { DynCustodySettlementJournalEntryDto } from '@/modules/entry-processor/models/dyn-custody-settlement-journal-entry.dto';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { UpdateSettingValueCommand } from '@/modules/settings/commands/update-setting-value.command';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

const EXCHANGE_RATE_CACHE_KEY = (date: string, currency: string) =>
  `${date}|${currency || ''}`;

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
  Entries: DynCustodySettlementJournalEntryDto[];
}

@Injectable()
export class CustodySettlementEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType =
    EntryProcessorTypes.LedgerCustodySettlementEntry;
  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
    'Vendor',
    'SubVendor',
    'Worker',
  ] as const;

  private readonly journalName = 'CustSettle';

  constructor(
    queryBus: QueryBus,
    db: DBService,
    private readonly generalJournalService: GeneralJournalService,
    private readonly commandBus: CommandBus,
  ) {
    // Pass null for customerInvoiceService as it's not needed for closing entries
    super(null as any, queryBus, db);
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    _billingClassId?: string,
  ): Promise<DynDataModel[]> {
    const accounts = await this.getAccountCustomerInvoiceMappings(
      ServiceTypes.Freight,
    );
    const { lastBatch, lastVoucher } = await this.loadCounters(company);
    const ledgerData = this.filterAndMapLedgerData(data, accounts);
    const exchangeRateMap = await this.buildExchangeRateMap(ledgerData);
    const groupedLedger = this.groupEntries(ledgerData, exchangeRateMap);
    const dynData = this.processGroupedLedger(
      groupedLedger,
      lastVoucher,
      lastBatch,
    );
    await this.finalizeCountersAndSettings(lastBatch, lastVoucher);
    return dynData;
  }

  private async buildExchangeRateMap(
    ledgerData: CustodySettlementEntryModel[],
  ): Promise<Map<string, { exchangeRate: number; reportingRate: number }>> {
    const uniqueDateCurrency = new Map<
      string,
      { date: string; currency: string }
    >();
    for (const entry of ledgerData) {
      const dateStr = String(entry.TRANSDATE);
      const currency = entry.CURRENCYCODE || '';
      const key = EXCHANGE_RATE_CACHE_KEY(dateStr, currency);
      if (!uniqueDateCurrency.has(key)) {
        uniqueDateCurrency.set(key, { date: dateStr, currency });
      }
    }
    const entries = await Promise.all(
      Array.from(uniqueDateCurrency.values()).map(
        async ({ date, currency }) => {
          const rates = await this.fetchExchangeRates(date, currency);
          return [EXCHANGE_RATE_CACHE_KEY(date, currency), rates] as const;
        },
      ),
    );
    return new Map(entries);
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
  ): DynCustodySettlementJournalEntryDto[] {
    const dynData: DynCustodySettlementJournalEntryDto[] = [];
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
    const arData = data as DynCustodySettlementJournalEntryDto[];
    const accounts = await this.getAllMainAccounts();

    const dimensionsMap = new Map<string, IFinancialDimensionValue[]>();
    for (const dimensionKey of this.requiredDimensions) {
      const dimensionValues =
        await this.getFinancialDimensionValues(dimensionKey);
      dimensionsMap.set(dimensionKey, dimensionValues || []);
    }

    // Validate each line
    for (const arLine of arData) {
      if (arLine.AccountType === 'Ledger') {
        this.validateMainAccount(
          arLine,
          accounts.map((a: any) => ({ accountNumber: a.accountNumber })),
        );
      }
      this.validateActivityName(arLine, dimensionsMap.get('Activity') || []);
      this.validateCostCenter(arLine, dimensionsMap.get('CostCenters') || []);
      this.validateBusinessUnit(
        arLine,
        dimensionsMap.get('BusinessUnit') || [],
      );
      this.validateLocation(arLine, dimensionsMap.get('Location') || []);
      this.validateCustomerDimension(
        arLine,
        dimensionsMap.get('Customer') || [],
        false,
      );
      this.validateSubCustomerDimension(
        arLine,
        dimensionsMap.get('SubCustomer') || [],
        false,
      );
      this.validateChargeTypeDimension(
        arLine,
        dimensionsMap.get('ChargeType')?.map((d) => d.value) || [],
      );
      this.validateSalesMan(arLine, dimensionsMap.get('SalesMan') || [], false);
      this.validateFreightType(arLine, dimensionsMap.get('FreightType') || []);
      this.validateDirection(arLine, dimensionsMap.get('Direction') || []);
      this.validateCoordinatorMan(
        arLine,
        dimensionsMap.get('CoordinatorMan') || [],
        false,
      );
      if (arLine.AccountType === 'Vend') {
        this.validateVendor(arLine, dimensionsMap.get('Vendor') || []);
        this.validateSubVendor(arLine, dimensionsMap.get('SubVendor') || []);
      }
      this.validateWorker(arLine, dimensionsMap.get('Worker') || [], false);
    }

    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    const batches = (data as DynCustodySettlementJournalEntryDto[]).reduce(
      (acc, entry) => {
        const batchNum = entry.JournalBatchNumber;
        if (!acc[batchNum]) {
          acc[batchNum] = [];
        }
        acc[batchNum].push(entry);
        return acc;
      },
      {} as Record<string, DynCustodySettlementJournalEntryDto[]>,
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

  private createJournalEntryDto(
    lineNumber: number,
    batchNumber: string,
    voucherNumber: string,
    source: CustodySettlementEntryModel,
    dimensionsModel: AccountDimensionsModel,
    exchangeRateMap: Map<
      string,
      { exchangeRate: number; reportingRate: number }
    >,
  ): DynCustodySettlementJournalEntryDto {
    const transDate = new Date(source.TRANSDATE);
    const exchangeKey = EXCHANGE_RATE_CACHE_KEY(
      String(source.TRANSDATE),
      source.CURRENCYCODE || '',
    );
    const { exchangeRate, reportingRate } = exchangeRateMap.get(
      exchangeKey,
    ) ?? {
      exchangeRate: 100,
      reportingRate: 100,
    };

    const sourceJournalName = source?.JOURNALNAME?.trim()?.toLowerCase() || '';
    const descriptionSuffix =
      sourceJournalName === 'cashin'
        ? 'Cash In'
        : sourceJournalName === 'cashout'
          ? 'Cash Out'
          : 'Without Cash';
    const monthYearLabel = formatToMonthYear(String(source.TRANSDATE));

    const line = new DynCustodySettlementJournalEntryDto();
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

      ledgerEntry.AccountDimensions = this.parseToDimensions(
        ledgerEntry.ACCOUNTTYPE === 'Ledger'
          ? ledgerEntry.ACCOUNTDISPLAYVALUE || ''
          : ledgerEntry.DEFAULTDIMENSIONDISPLAYVALUE || '',
      );

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

  private groupEntries(
    ledgerData: CustodySettlementEntryModel[],
    exchangeRateMap: Map<
      string,
      { exchangeRate: number; reportingRate: number }
    >,
  ): MonthGroup[] {
    const monthGroups = ledgerData.reduce(
      (acc, entry) => {
        const date = new Date(entry.TRANSDATE);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const key = `${year}-${month}`;

        if (!acc[key]) {
          acc[key] = {
            Year: year,
            Month: month,
            Entries: [],
          };
        }

        const journalEntry = this.createJournalEntryDto(
          entry.getLineNumber(),
          '0',
          '',
          entry,
          entry.AccountDimensions!,
          exchangeRateMap,
        );
        acc[key].Entries.push(journalEntry);

        return acc;
      },
      {} as Record<string, MonthGroup>,
    );

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
    entries: DynCustodySettlementJournalEntryDto[],
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
        {} as Record<string, DynCustodySettlementJournalEntryDto[]>,
      );

    for (const group of Object.values(groups)) {
      lastVoucher.lastNumber += 1;
      const voucher = lastVoucher.lastNumber;

      for (const entry of group) {
        entry.Voucher = this.formatVoucherNumber(voucher, this.journalName);
      }
    }
  }

  private applyBatchNumbersAndAggregate(
    entries: DynCustodySettlementJournalEntryDto[],
    lastBatch: ClosingBatchCounter,
    dynData: DynCustodySettlementJournalEntryDto[],
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
      {} as Record<string, DynCustodySettlementJournalEntryDto[]>,
    );

    for (const voucherEntries of Object.values(vouchers)) {
      if (batchLineNumber + voucherEntries.length > 1000) {
        lastBatch.lastBatchNumber += 1;
        batchLineNumber = 1;
      }

      for (const entry of voucherEntries) {
        entry.LineNumber = batchLineNumber++;
        entry.JournalBatchNumber = this.formatBatchNumber(
          lastBatch.lastBatchNumber,
        );
        dynData.push(entry);
      }
    }
  }
}
