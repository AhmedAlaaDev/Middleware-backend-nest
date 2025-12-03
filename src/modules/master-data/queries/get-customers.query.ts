import { Query } from '@nestjs/cqrs';

export interface Customer {
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
  defaultDimensionDisplayValue?: string;
}

export class GetCustomersQuery extends Query<Customer[]> {
  constructor(
    public readonly company?: string,
    public readonly searchTerm?: string,
  ) {
    super();
  }
}
