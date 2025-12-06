import {
  ICreateMainAccount,
  IMainAccount,
  IMainAccountListFilter,
} from '@/modules/master-data/interfaces/main-account.interface';

export abstract class MainAccountRepository {
  abstract upsertMany(
    chartNumber: string,
    accounts: ICreateMainAccount[],
  ): Promise<void>;
  abstract getList(
    filter: IMainAccountListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IMainAccount[]>;
  abstract getCount(filter: IMainAccountListFilter): Promise<number>;
}
