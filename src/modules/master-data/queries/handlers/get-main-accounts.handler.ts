import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IMainAccount } from '@/modules/master-data/interfaces/main-account.interface';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetMainAccountsQuery)
export class GetMainAccountsHandler implements IQueryHandler<GetMainAccountsQuery> {
  private readonly logger = new Logger(GetMainAccountsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetMainAccountsQuery): Promise<IMainAccount[]> {
    this.logger.log(
      `Fetching main accounts from database${query.chartOfAccounts ? ` for chart of accounts: ${query.chartOfAccounts}` : ''}`,
    );

    const { items } = await this.masterDataService.getMainAccountsAsync({
      chartNumber: query.chartOfAccounts,
    });

    return items;
  }
}
