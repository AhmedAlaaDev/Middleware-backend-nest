import {
  ICreateExchangeRate,
  IExchangeRate,
  IExchangeRateListFilter,
} from '@/modules/master-data/interfaces/exchange-rate.interface';

export abstract class ExchangeRateRepository {
  abstract upsertMany(rates: ICreateExchangeRate[]): Promise<void>;
  abstract getList(
    filter: IExchangeRateListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IExchangeRate[]>;
  abstract getCount(filter: IExchangeRateListFilter): Promise<number>;
}
