export class IMainAccount {
  id: string;
  chartNumber: string;
  accountNumber: string;
  accountName: string;
}

export interface ICreateMainAccount {
  accountName: string;
  chartNumber: string;
  accountNumber: string;
}

export type IUpdateMainAccount = Partial<ICreateMainAccount>;

export interface IMainAccountListFilter {
  chartNumber?: string;
  accountName?: string;
}
