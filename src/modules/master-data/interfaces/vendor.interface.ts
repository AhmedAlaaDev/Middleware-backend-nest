export class IVendor {
  id: string;
  company: string;
  vendorAccountNumber: string;
  vendorOrganizationName?: string;
  vendorSearchName?: string;
  vendorGroupId?: string;
  currencyCode?: string;
  defaultPaymentTermsName?: string;
  salesTaxGroupCode?: string;
  onHoldStatus?: string;
}

export interface ICreateVendor {
  company: string;
  vendorAccountNumber: string;
  vendorOrganizationName?: string;
  vendorSearchName?: string;
  vendorGroupId?: string;
  currencyCode?: string;
  defaultPaymentTermsName?: string;
  salesTaxGroupCode?: string;
  onHoldStatus?: string;
}

export type IUpdateVendor = Partial<ICreateVendor>;

export interface IVendorListFilter {
  company?: string;
  accountNumbers?: string[];
}
