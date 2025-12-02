import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { GetMainAccountsQuery, MainAccount } from '../get-main-accounts.query';

@QueryHandler(GetMainAccountsQuery)
export class GetMainAccountsHandler
  implements IQueryHandler<GetMainAccountsQuery>
{
  private readonly logger = new Logger(GetMainAccountsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetMainAccountsQuery,
  ): Promise<MainAccount[]> {
    this.logger.log(
      `Fetching main accounts from database${query.chartOfAccounts ? ` for chart of accounts: ${query.chartOfAccounts}` : ''}`,
    );

    const filter = query.chartOfAccounts
      ? { chartNumber: query.chartOfAccounts }
      : {};
    const accounts = await this.db.mainAccountModel.find(filter).lean();

    return accounts.map((a: any) => ({
      id: a._id.toString(),
      chartNumber: a.chartNumber,
      accountNumber: a.accountNumber,
    }));
  }
}

