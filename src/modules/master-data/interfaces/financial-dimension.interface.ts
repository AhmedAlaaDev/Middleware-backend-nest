export class IFinancialDimensionValue {
  id: string;
  financialDimensionKey: string;
  value: string;
  description?: string;
  isSuspended?: 'Yes' | 'No';
  isBlockedForManualEntry?: 'Yes' | 'No';
  isTotal?: 'Yes' | 'No';
  activeFrom?: Date;
  activeTo?: Date;
}

export interface ICreateFinancialDimensionValue {
  financialDimensionKey: string;
  value: string;
  description?: string;
  isSuspended?: 'Yes' | 'No';
  isBlockedForManualEntry?: 'Yes' | 'No';
  isTotal?: 'Yes' | 'No';
  activeFrom?: Date;
  activeTo?: Date;
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
  value?: string;
}

export interface IGetFinancialDimensionValueFilter {
  value?: string;
}
