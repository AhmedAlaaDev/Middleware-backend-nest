import {
  ICreateFinancialDimension,
  ICreateFinancialDimensionValue,
  IFinancialDimension,
  IFinancialDimensionValue,
  IFinancialDimensionValueListFilter,
} from '@/modules/master-data/interfaces/financial-dimension.interface';

export abstract class FinancialDimensionRepository {
  abstract upsertMany(items: ICreateFinancialDimension[]): Promise<void>;
  abstract getList(options?: {
    skipCount?: number;
    maxCount?: number;
  }): Promise<IFinancialDimension[]>;
  abstract findByKey(financialKey: string): Promise<IFinancialDimension | null>;
}

export abstract class FinancialDimensionValueRepository {
  abstract upsertMany(values: ICreateFinancialDimensionValue[]): Promise<void>;
  abstract getList(
    filter: IFinancialDimensionValueListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IFinancialDimensionValue[]>;
}
