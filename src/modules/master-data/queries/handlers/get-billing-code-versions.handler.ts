import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IBillingCodeVersion } from '@/modules/master-data/interfaces/billing-code-version.interface';
import { GetBillingCodeVersionsQuery } from '@/modules/master-data/queries/get-billing-code-versions.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetBillingCodeVersionsQuery)
export class GetBillingCodeVersionsHandler implements IQueryHandler<GetBillingCodeVersionsQuery> {
  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetBillingCodeVersionsQuery,
  ): Promise<IPaginatedRes<IBillingCodeVersion>> {
    const { items, total } =
      await this.masterDataService.getBillingCodeVersionsAsync(
        query.filter,
        query.skipCount,
        query.maxCount,
      );

    return new IPaginatedRes(items, total, query.maxCount, query.skipCount);
  }
}
