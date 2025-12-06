import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IFinancialDimension } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetFinancialDimensionsQuery } from '@/modules/master-data/queries/get-financial-dimensions.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetFinancialDimensionsQuery)
export class GetFinancialDimensionsHandler implements IQueryHandler<GetFinancialDimensionsQuery> {
  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    _query: GetFinancialDimensionsQuery,
  ): Promise<IFinancialDimension[]> {
    const dimensions =
      await this.masterDataService.getFinancialDimensionsWithValuesAsync();

    return dimensions;
  }
}
