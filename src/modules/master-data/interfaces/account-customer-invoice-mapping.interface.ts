import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';

export class IAccountCustomerInvoiceMapping {
  id: string;
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
}

export interface ICreateAccountCustomerInvoiceMapping {
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
}

export type IUpdateAccountCustomerInvoiceMapping =
  Partial<ICreateAccountCustomerInvoiceMapping>;

export interface IAccountCustomerInvoiceMappingFilter {
  serviceType?: ServiceTypes;
}
