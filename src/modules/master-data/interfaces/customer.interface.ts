export class ICustomer {
  id: string;
  company: string;
  customerAccount: string;
  name?: string;
  organizationPhoneticName?: string;
  nameAlias?: string;
  customerGroupId?: string;
  salesCurrencyCode?: string;
  invoiceAccount?: string;
  partyNumber?: string;
  organizationNumber?: string;
  taxExemptNumber?: string;
  defaultDimensionDisplayValue?: string;
}

export interface ICreateCustomer {
  company: string;
  customerAccount: string;
  name?: string;
  organizationPhoneticName?: string;
  nameAlias?: string;
  customerGroupId?: string;
  salesCurrencyCode?: string;
  invoiceAccount?: string;
  partyNumber?: string;
  organizationNumber?: string;
  taxExemptNumber?: string;
  defaultDimensionDisplayValue?: string;
}

export type IUpdateCustomer = Partial<ICreateCustomer>;

export interface ICustomerListFilter {
  company?: string;
  searchTerm?: string;
}
