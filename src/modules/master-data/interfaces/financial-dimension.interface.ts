export class IFinancialDimensionValue {
  id: string;
  financialDimensionKey: string;
  value: string;
  description?: string;
}

export interface ICreateFinancialDimensionValue {
  financialDimensionKey: string;
  value: string;
  description?: string;
}

export type IUpdateFinancialDimensionValue =
  Partial<ICreateFinancialDimensionValue>;

export class IFinancialDimension {
  id: string;
  financialKey: string;
  dimensionValues?: IFinancialDimensionValue[];
}

export interface ICreateFinancialDimension {
  financialKey: string;
}

export type IUpdateFinancialDimension = Partial<ICreateFinancialDimension>;

export interface IFinancialDimensionValueListFilter {
  financialDimensionKey?: string;
}
