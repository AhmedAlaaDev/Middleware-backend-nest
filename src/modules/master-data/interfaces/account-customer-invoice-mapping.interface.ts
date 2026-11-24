import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';

export class IAccountCustomerInvoiceMapping {
  id: string;
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
  company?: string;
}

export interface ICreateAccountCustomerInvoiceMapping {
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
  /** Owning company (m-p or mas). Saves without it are stored as m-p, as before. */
  company?: string;
}

export type IUpdateAccountCustomerInvoiceMapping =
  Partial<ICreateAccountCustomerInvoiceMapping>;

export interface IAccountCustomerInvoiceMappingFilter {
  serviceType?: ServiceTypes;
  /**
   * Only mappings for this company. For m-p, legacy mappings without a company also match.
   */
  company?: string;
}
