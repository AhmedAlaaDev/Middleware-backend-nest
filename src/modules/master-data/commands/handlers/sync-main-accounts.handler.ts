import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ChartOfAccountsService } from '@/modules/d365fo/services/chart-of-accounts.service';
import { SyncMainAccountsCommand } from '@/modules/master-data/commands/sync-main-accounts.command';
import { ICreateMainAccount } from '@/modules/master-data/interfaces/main-account.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncMainAccountsCommand)
export class SyncMainAccountsHandler implements ICommandHandler<SyncMainAccountsCommand> {
  private readonly logger = new Logger(SyncMainAccountsHandler.name);

  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncMainAccountsCommand): Promise<{
    accountsCreated: number;
    accountsUpdated: number;
  }> {
    this.logger.log(
      `Syncing main accounts from D365FO for chart of accounts: ${command.chartOfAccounts}`,
    );

    let accountsCreated = 0;
    let accountsUpdated = 0;

    // Fetch all main accounts from D365FO using automatic pagination
    const allAccounts = await this.chartOfAccountsService.getAllMainAccounts(
      command.chartOfAccounts,
      {
        useCache: false, // Don't use cache for sync operations
      },
    );

    this.logger.log(`Fetched ${allAccounts.length} main accounts from D365FO`);

    const existing = await this.masterDataService.getMainAccountsAsync({
      chartNumber: command.chartOfAccounts,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((a) =>
      existingMap.set(a.accountNumber.toLowerCase(), true),
    );

    const accountPayload: ICreateMainAccount[] = [];
    for (const account of allAccounts) {
      const chartNumber = account.ChartOfAccounts || '';
      const accountNumber = account.MainAccountId || '';
      const accountName = account.Name || '';

      if (!chartNumber || !accountNumber) {
        this.logger.warn(
          'Skipping main account with missing chartNumber or accountNumber',
          account,
        );
        continue;
      }

      if (existingMap.has(accountNumber.toLowerCase())) {
        accountsUpdated++;
      } else {
        accountsCreated++;
        existingMap.set(accountNumber.toLowerCase(), true);
      }

      accountPayload.push({
        chartNumber: chartNumber,
        accountNumber: accountNumber,
        accountName: accountName,
        mainAccountType: account.MainAccountType,
        isSuspended: account.IsSuspended,
        doNotAllowManualEntry: account.DoNotAllowManualEntry,
      });
    }

    if (accountPayload.length > 0) {
      await this.masterDataService.upsertMainAccountsAsync(
        command.chartOfAccounts,
        accountPayload,
      );
    }

    this.logger.log(
      `Sync completed: ${accountsCreated} accounts created, ${accountsUpdated} accounts updated`,
    );

    return {
      accountsCreated,
      accountsUpdated,
    };
  }
}
