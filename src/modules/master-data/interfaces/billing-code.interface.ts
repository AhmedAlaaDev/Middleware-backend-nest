export class IBillingCode {
  id: string;
  dataAreaId: string;
  billingCode: string;
  billingClassification: string;
}

export interface ICreateBillingCode {
  dataAreaId: string;
  billingCode: string;
  billingClassification: string;
}

export type IUpdateBillingCode = Partial<ICreateBillingCode>;

export interface IBillingCodeListFilter {
  company?: string;
  billingClassification?: string;
}
