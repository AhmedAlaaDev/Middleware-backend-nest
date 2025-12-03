import { Query } from '@nestjs/cqrs';

export interface Vendor {
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

export class GetVendorsQuery extends Query<Vendor[]> {
  constructor(public readonly company?: string) {
    super();
  }
}
