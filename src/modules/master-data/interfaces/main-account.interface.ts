export class IMainAccount {
  id: string;
  chartNumber: string;
  accountNumber: string;
}

export interface ICreateMainAccount {
  chartNumber: string;
  accountNumber: string;
}

export type IUpdateMainAccount = Partial<ICreateMainAccount>;

export interface IMainAccountListFilter {
  chartNumber?: string;
}
