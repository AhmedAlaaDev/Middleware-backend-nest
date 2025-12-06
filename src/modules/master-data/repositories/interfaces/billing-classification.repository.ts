import {
  ICreateBillingClassification,
  IBillingClassification,
  IBillingClassificationListFilter,
} from '@/modules/master-data/interfaces/billing-classification.interface';

export abstract class BillingClassificationRepository {
  abstract upsertMany(
    company: string,
    items: ICreateBillingClassification[],
  ): Promise<void>;
  abstract getList(
    filter: IBillingClassificationListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingClassification[]>;
  abstract getCount(filter: IBillingClassificationListFilter): Promise<number>;
}
