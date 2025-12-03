import { FinancialDimension, FinancialDimensionValue } from '@/modules/master-data/queries/get-financial-dimensions.query';
import { Query } from '@nestjs/cqrs';


export class GetFinancialDimensionWithValueQuery extends Query<{ FinancialDimension: FinancialDimension, Values: FinancialDimensionValue[] }> {
    constructor(
        public readonly financialKey?: string
    ) {
        super();
    }
}
