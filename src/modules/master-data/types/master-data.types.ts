export enum ServiceTypes {
  Freight = 1,
  Trucking = 2,
  FreightCreditNote = 3,
  TruckingCreditNote = 4,
}

export const ServiceTypesEnum = ServiceTypes;

export interface AccountCustomerInvoiceMapping {
  id: string;
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
}
