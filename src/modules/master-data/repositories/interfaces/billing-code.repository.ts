import {
  ICreateBillingCode,
  IBillingCode,
  IBillingCodeListFilter,
} from '@/modules/master-data/interfaces/billing-code.interface';

export abstract class BillingCodeRepository {
  abstract upsertMany(
    company: string,
    codes: ICreateBillingCode[],
  ): Promise<void>;
  abstract getList(
    filter: IBillingCodeListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingCode[]>;
  abstract getCount(filter: IBillingCodeListFilter): Promise<number>;
}
