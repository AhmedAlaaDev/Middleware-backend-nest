import {
  ICreateTaxItemGroupHeading,
  ITaxItemGroupHeading,
  ITaxItemGroupHeadingListFilter,
} from '@/modules/master-data/interfaces/tax-item-group-heading.interface';

export abstract class TaxItemGroupHeadingRepository {
  abstract upsertMany(
    company: string,
    items: ICreateTaxItemGroupHeading[],
  ): Promise<void>;
  abstract getList(
    filter: ITaxItemGroupHeadingListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ITaxItemGroupHeading[]>;
  abstract getCount(filter: ITaxItemGroupHeadingListFilter): Promise<number>;
}
