import { VENDOR_GROUP_IDS } from '@/modules/master-data/constants/vendor';

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
  vendorGroupIds?: (typeof VENDOR_GROUP_IDS)[number][];
  searchTerm?: string;
}
