export class IMainAccount {
  id: string;
  chartNumber: string;
  accountNumber: string;
  accountName: string;
  mainAccountType?: string;
  isSuspended?: 'Yes' | 'No';
  doNotAllowManualEntry?: 'Yes' | 'No';
}

export interface ICreateMainAccount {
  accountName: string;
  chartNumber: string;
  accountNumber: string;
  mainAccountType?: string;
  isSuspended?: 'Yes' | 'No';
  doNotAllowManualEntry?: 'Yes' | 'No';
}

export type IUpdateMainAccount = Partial<ICreateMainAccount>;

export interface IMainAccountListFilter {
  chartNumber?: string;
  accountName?: string;
}
