import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import {
  IFinancialDimension,
  IFinancialDimensionValue,
} from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetFinancialDimensionWithValueQuery } from '@/modules/master-data/queries/get-financial-dimension-with-values.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetFinancialDimensionWithValueQuery)
export class GetFinancialDimensionWithValueHandler implements IQueryHandler<GetFinancialDimensionWithValueQuery> {
  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetFinancialDimensionWithValueQuery): Promise<{
    FinancialDimension: IFinancialDimension;
    Values: IFinancialDimensionValue[];
  }> {
    if (!query.financialKey) {
      return { FinancialDimension: undefined as any, Values: [] };
    }

    const { FinancialDimension, Values } =
      await this.masterDataService.getFinancialDimensionWithValuesAsync(
        query.financialKey,
      );

    if (!FinancialDimension) {
      return { FinancialDimension: undefined as any, Values: [] };
    }

    return {
      FinancialDimension,
      Values,
    };
  }
}
