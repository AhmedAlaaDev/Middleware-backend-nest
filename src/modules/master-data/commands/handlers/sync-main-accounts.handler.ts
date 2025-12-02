import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { D365FOMainAccount } from '@/modules/d365fo/types';
import { ChartOfAccountsService } from '@/modules/d365fo/services/chart-of-accounts.service';
import { DBService } from '@/modules/db/db.service';
import { SyncMainAccountsCommand } from '../sync-main-accounts.command';

@CommandHandler(SyncMainAccountsCommand)
export class SyncMainAccountsHandler
  implements ICommandHandler<SyncMainAccountsCommand>
{
  private readonly logger = new Logger(SyncMainAccountsHandler.name);

  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly db: DBService,
  ) {}

  public async execute(
    command: SyncMainAccountsCommand,
  ): Promise<{
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

    this.logger.log(
      `Fetched ${allAccounts.length} main accounts from D365FO`,
    );

    // Process each account
    for (const account of allAccounts) {
      const chartNumber = account.ChartOfAccounts || '';
      const accountNumber = account.MainAccountId || '';

      if (!chartNumber || !accountNumber) {
        this.logger.warn(
          'Skipping main account with missing chartNumber or accountNumber',
          account,
        );
        continue;
      }

      // Check if account exists in database - upsert logic
      const existingAccount = await this.db.mainAccountModel.findOne({
        chartNumber: chartNumber,
        accountNumber: accountNumber,
      });

      if (!existingAccount) {
        // Create new account
        await this.db.mainAccountModel.create({
          chartNumber: chartNumber,
          accountNumber: accountNumber,
        });
        accountsCreated++;
        this.logger.debug(
          `Created main account: ${chartNumber}/${accountNumber}`,
        );
      } else {
        // Account already exists - no update needed as we only store chartNumber and accountNumber
        // But we count it as processed for consistency
        accountsUpdated++;
      }
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

