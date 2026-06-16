import {
  IBillingCodeVersion,
  IBillingCodeVersionListFilter,
  ICreateBillingCodeVersion,
} from '@/modules/master-data/interfaces/billing-code-version.interface';

export abstract class BillingCodeVersionRepository {
  abstract upsertMany(
    company: string,
    versions: ICreateBillingCodeVersion[],
  ): Promise<void>;
  abstract getList(
    filter: IBillingCodeVersionListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingCodeVersion[]>;
  abstract getCount(filter: IBillingCodeVersionListFilter): Promise<number>;
}
