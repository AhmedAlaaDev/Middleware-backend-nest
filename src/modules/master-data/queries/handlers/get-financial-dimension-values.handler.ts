import { BadRequestException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IFinancialDimensionValue } from '@/modules/master-data/interfaces';
import { GetFinancialDimensionValueQuery } from '@/modules/master-data/queries';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetFinancialDimensionValueQuery)
export class GetFinancialDimensionValueHandler implements IQueryHandler<GetFinancialDimensionValueQuery> {
  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetFinancialDimensionValueQuery,
  ): Promise<IFinancialDimensionValue[]> {
    if (!query.financialKey) {
      throw new BadRequestException('Financial dimension key is required');
    }

    const values =
      await this.masterDataService.getFinancialDimensionWithValuesAsync(
        query.financialKey,
        query.filter,
      );

    return values;
  }
}
