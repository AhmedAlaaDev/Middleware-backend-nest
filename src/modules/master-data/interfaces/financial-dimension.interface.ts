export class IFinancialDimensionValue {
  id: string;
  financialDimensionKey: string;
  value: string;
  /** '' = shared by every company; otherwise the company the value is restricted to. Missing = legacy (m-p only). */
  legalEntityId?: string;
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
  legalEntityId?: string;
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
  /** Values applicable to this company: shared values plus those restricted to it. */
  company?: string;
}

export interface IGetFinancialDimensionValueFilter {
  value?: string;
  company?: string;
}
