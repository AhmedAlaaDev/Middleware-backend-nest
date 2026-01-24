import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { LedgerService } from '@/modules/d365fo/services/ledger.service';
import { SyncLedgersCommand } from '@/modules/master-data/commands/sync-ledgers.command';
import { ICreateLedger } from '@/modules/master-data/interfaces/ledger.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncLedgersCommand)
export class SyncLedgersHandler implements ICommandHandler<SyncLedgersCommand> {
  private readonly logger = new Logger(SyncLedgersHandler.name);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncLedgersCommand): Promise<{
    ledgersCreated: number;
    ledgersUpdated: number;
  }> {
    this.logger.log(
      `Syncing ledgers from D365FO for company: ${command.company}`,
    );

    let ledgersCreated = 0;
    let ledgersUpdated = 0;

    // Fetch all ledgers from D365FO using automatic pagination
    const allLedgers = await this.ledgerService.getAllLedgers(command.company, {
      useCache: false, // Don't use cache for sync operations
    });

    this.logger.log(`Fetched ${allLedgers.length} ledgers from D365FO`);

    const existing = await this.masterDataService.getLedgersAsync({
      company: command.company,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((l) =>
      existingMap.set(l.legalEntityId.toLowerCase(), true),
    );

    const ledgerPayload: ICreateLedger[] = [];
    for (const ledger of allLedgers) {
      const legalEntityId = ledger.LegalEntityId || '';

      if (!legalEntityId) {
        this.logger.warn('Skipping ledger with missing LegalEntityId', ledger);
        continue;
      }

      const ledgerData: ICreateLedger = {
        legalEntityId: legalEntityId,
        accountingCurrency: ledger.AccountingCurrency || '',
        reportingCurrency: ledger.ReportingCurrency || '',
        name: ledger.Name,
        description: ledger.Description,
        chartOfAccounts: ledger.ChartOfAccounts,
        fiscalCalendar: ledger.FiscalCalendar,
        reportingCurrencyExchangeRateType:
          ledger.ReportingCurrencyExchangeRateType,
        budgetExchangeRateType: ledger.BudgetExchangeRateType,
        exchangeRateType: ledger.ExchangeRateType,
        chartOfAccountsRecId: ledger.ChartOfAccountsRecId,
        ledgerRecId: ledger.LedgerRecId,
        accountStructureName1: ledger.AccountStructureName1,
        accountStructureName2: ledger.AccountStructureName2,
        accountStructureName3: ledger.AccountStructureName3,
        accountStructureName4: ledger.AccountStructureName4,
        accountStructureName5: ledger.AccountStructureName5,
        accountStructureName6: ledger.AccountStructureName6,
        accountStructureName7: ledger.AccountStructureName7,
        accountStructureName8: ledger.AccountStructureName8,
        accountStructureName9: ledger.AccountStructureName9,
        accountStructureName10: ledger.AccountStructureName10,
        accountStructureName11: ledger.AccountStructureName11,
        accountStructureName12: ledger.AccountStructureName12,
        accountStructureName13: ledger.AccountStructureName13,
        accountStructureName14: ledger.AccountStructureName14,
        accountStructureName15: ledger.AccountStructureName15,
        accountStructureName16: ledger.AccountStructureName16,
        accountStructureName17: ledger.AccountStructureName17,
        accountStructureName18: ledger.AccountStructureName18,
        accountStructureName19: ledger.AccountStructureName19,
        accountStructureName20: ledger.AccountStructureName20,
        mainAccountIdUnrealizedLoss: ledger.MainAccountIdUnrealizedLoss,
        mainAccountIdRealizedGain: ledger.MainAccountIdRealizedGain,
        mainAccountIdRealizedLoss: ledger.MainAccountIdRealizedLoss,
        mainAccountIdFinancialGain: ledger.MainAccountIdFinancialGain,
        mainAccountIdUnrealizedGain: ledger.MainAccountIdUnrealizedGain,
        mainAccountIdFinancialLoss: ledger.MainAccountIdFinancialLoss,
        isBudgetControlEnabled: ledger.IsBudgetControlEnabled,
        balancingFinancialDimension: ledger.BalancingFinancialDimension,
      };

      if (existingMap.has(legalEntityId.toLowerCase())) {
        ledgersUpdated++;
      } else {
        ledgersCreated++;
        existingMap.set(legalEntityId.toLowerCase(), true);
      }

      ledgerPayload.push(ledgerData);
    }

    if (ledgerPayload.length > 0) {
      await this.masterDataService.upsertLedgersAsync(
        command.company,
        ledgerPayload,
      );
    }

    this.logger.log(
      `Sync completed: ${ledgersCreated} ledgers created, ${ledgersUpdated} ledgers updated`,
    );

    return {
      ledgersCreated,
      ledgersUpdated,
    };
  }
}
