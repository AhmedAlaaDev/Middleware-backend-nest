import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { DBService } from '@/modules/db/db.service';
import { FinancialDimension } from '@/modules/master-data/master-data.service';
import { GetFinancialDimensionsQuery } from '../get-financial-dimensions.query';

@QueryHandler(GetFinancialDimensionsQuery)
export class GetFinancialDimensionsHandler
  implements IQueryHandler<GetFinancialDimensionsQuery>
{
  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetFinancialDimensionsQuery,
  ): Promise<FinancialDimension[]> {
    const dimensions = await this.db.financialDimensionModel
      .find()
      .populate('dimensionValues')
      .lean();

    return dimensions.map((d: any) => ({
      id: d._id.toString(),
      financialKey: d.financialKey,
      dimensionValues: (d?.dimensionValues || []).map((v: any) => ({
        id: v._id.toString(),
        financialDimensionKey: v.financialDimensionKey,
        value: v.value,
        description: v.description || undefined,
      })),
    }));
  }
}

