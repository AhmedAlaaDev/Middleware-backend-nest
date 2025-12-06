import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IFinancialDimension } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetFinancialDimensionsQuery } from '@/modules/master-data/queries/get-financial-dimensions.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetFinancialDimensionsQuery)
export class GetFinancialDimensionsHandler implements IQueryHandler<GetFinancialDimensionsQuery> {
  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetFinancialDimensionsQuery,
  ): Promise<IPaginatedRes<IFinancialDimension>> {
    const skipCount = query.skipCount ?? 0;
    const maxCount = query.maxCount ?? 150;

    const { count, items } =
      await this.masterDataService.getFinancialDimensionsWithValuesAsync(
        skipCount,
        maxCount,
      );

    return new IPaginatedRes(items, count, maxCount, skipCount);
  }
}
