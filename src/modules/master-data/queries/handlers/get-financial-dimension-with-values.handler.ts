import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetFinancialDimensionWithValueQuery } from '../get-financial-dimension-with-values.query';
import { FinancialDimension, FinancialDimensionValue } from '../get-financial-dimensions.query';

import { DBService } from '@/modules/db/db.service';

@QueryHandler(GetFinancialDimensionWithValueQuery)
export class GetFinancialDimensionWithValueHandler
    implements IQueryHandler<GetFinancialDimensionWithValueQuery> {
    constructor(private readonly db: DBService) { }

    public async execute(
        query: GetFinancialDimensionWithValueQuery,
    ): Promise<{ FinancialDimension: FinancialDimension; Values: FinancialDimensionValue[] }> {
        if (!query.financialKey) {
            return { FinancialDimension: undefined as any, Values: [] };
        }

        const dimDoc: any = await this.db.financialDimensionModel
            .findOne({ financialKey: query.financialKey })
            .lean();

        if (!dimDoc) {
            return { FinancialDimension: undefined as any, Values: [] };
        }

        const valueDocs: any[] = await this.db.financialDimensionValueModel
            .find({ financialDimensionKey: dimDoc.financialKey })
            .lean();

        const values: FinancialDimensionValue[] = (valueDocs || []).map((v: any) => ({
            id: v._id.toString(),
            financialDimensionKey: v.financialDimensionKey,
            value: v.value,
            description: v.description || undefined,
        }));

        const FinancialDimension: FinancialDimension = {
            id: dimDoc._id.toString(),
            financialKey: dimDoc.financialKey,
            dimensionValues: values,
        };

        return { FinancialDimension, Values: values };
    }
}

