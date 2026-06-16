export class IBillingCodeVersion {
  id: string;
  dataAreaId: string;
  billingCode: string;
  billingCodeDescription: string;
  validFrom: Date;
  validTo: Date;
  itemSalesTaxGroup?: string;
  rateType?: string;
}

export interface ICreateBillingCodeVersion {
  dataAreaId: string;
  billingCode: string;
  billingCodeDescription: string;
  validFrom: Date;
  validTo: Date;
  itemSalesTaxGroup?: string;
  rateType?: string;
}

export type IUpdateBillingCodeVersion = Partial<ICreateBillingCodeVersion>;

export interface IBillingCodeVersionListFilter {
  company?: string;
  billingCode?: string;
  billingCodeDescription?: string;
}
