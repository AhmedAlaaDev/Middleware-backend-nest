import { Query } from '@nestjs/cqrs';

export interface FinancialDimension {
  id: string;
  financialKey: string;
  dimensionValues: FinancialDimensionValue[];
}

export interface FinancialDimensionValue {
  id: string;
  financialDimensionKey: string;
  value: string;
  description?: string;
}

export class GetFinancialDimensionsQuery extends Query<FinancialDimension[]> {
  constructor() {
    super();
  }
}

