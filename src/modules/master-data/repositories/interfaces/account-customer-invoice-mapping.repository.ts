import {
  IAccountCustomerInvoiceMapping,
  ICreateAccountCustomerInvoiceMapping,
  IAccountCustomerInvoiceMappingFilter,
} from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';

export abstract class AccountCustomerInvoiceMappingRepository {
  abstract upsertMany(
    mappings: ICreateAccountCustomerInvoiceMapping[],
  ): Promise<void>;
  abstract getList(
    filter: IAccountCustomerInvoiceMappingFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IAccountCustomerInvoiceMapping[]>;
  abstract getCount(
    filter: IAccountCustomerInvoiceMappingFilter,
  ): Promise<number>;
}
