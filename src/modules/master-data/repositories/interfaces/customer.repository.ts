import {
  ICreateCustomer,
  ICustomer,
  ICustomerListFilter,
} from '@/modules/master-data/interfaces/customer.interface';

export abstract class CustomerRepository {
  abstract upsertMany(
    company: string,
    customers: ICreateCustomer[],
  ): Promise<void>;
  abstract getList(
    filter: ICustomerListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ICustomer[]>;
  abstract getCount(filter: ICustomerListFilter): Promise<number>;
  abstract findByAccount(
    company: string,
    customerAccount: string,
  ): Promise<ICustomer | null>;
  abstract deleteByCompany(company: string): Promise<void>;
}
