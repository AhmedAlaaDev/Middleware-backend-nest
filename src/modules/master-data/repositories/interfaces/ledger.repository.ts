import {
  ICreateLedger,
  ILedger,
  ILedgerListFilter,
} from '@/modules/master-data/interfaces/ledger.interface';

export abstract class LedgerRepository {
  abstract getList(
    filter: ILedgerListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ILedger[]>;
  abstract getCount(filter: ILedgerListFilter): Promise<number>;
  abstract upsertMany(company: string, ledgers: ICreateLedger[]): Promise<void>;
}
