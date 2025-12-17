import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IMainAccount } from '@/modules/master-data/interfaces/main-account.interface';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetMainAccountsQuery)
export class GetMainAccountsHandler implements IQueryHandler<GetMainAccountsQuery> {
  private readonly logger = new Logger(GetMainAccountsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetMainAccountsQuery,
  ): Promise<IPaginatedRes<IMainAccount>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    this.logger.log(
      `Fetching main accounts from database${query.filter?.chartNumber ? ` for chart of accounts: ${query.filter.chartNumber}` : ''}`,
    );

    const { items, total } = await this.masterDataService.getMainAccountsAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
