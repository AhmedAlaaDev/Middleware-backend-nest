import { Injectable } from '@nestjs/common';

import {
  IAccountCustomerInvoiceMapping,
  IAccountCustomerInvoiceMappingFilter,
  ICreateAccountCustomerInvoiceMapping,
} from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';
import {
  IBillingClassification,
  ICreateBillingClassification,
  IBillingClassificationListFilter,
} from '@/modules/master-data/interfaces/billing-classification.interface';
import {
  IBillingCode,
  ICreateBillingCode,
  IBillingCodeListFilter,
} from '@/modules/master-data/interfaces/billing-code.interface';
import {
  ICustomer,
  ICreateCustomer,
  ICustomerListFilter,
} from '@/modules/master-data/interfaces/customer.interface';
import {
  IExchangeRate,
  ICreateExchangeRate,
  IExchangeRateListFilter,
} from '@/modules/master-data/interfaces/exchange-rate.interface';
import {
  IFinancialDimension,
  IFinancialDimensionValue,
  ICreateFinancialDimension,
  ICreateFinancialDimensionValue,
  IFinancialDimensionValueListFilter,
} from '@/modules/master-data/interfaces/financial-dimension.interface';
import {
  IMainAccount,
  ICreateMainAccount,
  IMainAccountListFilter,
} from '@/modules/master-data/interfaces/main-account.interface';
import {
  IVendor,
  ICreateVendor,
  IVendorListFilter,
} from '@/modules/master-data/interfaces/vendor.interface';
import {
  AccountCustomerInvoiceMappingRepository,
  BillingClassificationRepository,
  BillingCodeRepository,
  CustomerRepository,
  ExchangeRateRepository,
  FinancialDimensionRepository,
  FinancialDimensionValueRepository,
  MainAccountRepository,
  VendorRepository,
} from '@/modules/master-data/repositories/interfaces';

@Injectable()
export class MasterDataService {
  constructor(
    private readonly vendorRepo: VendorRepository,
    private readonly customerRepo: CustomerRepository,
    private readonly mainAccountRepo: MainAccountRepository,
    private readonly billingCodeRepo: BillingCodeRepository,
    private readonly billingClassificationRepo: BillingClassificationRepository,
    private readonly exchangeRateRepo: ExchangeRateRepository,
    private readonly finDimRepo: FinancialDimensionRepository,
    private readonly finDimValRepo: FinancialDimensionValueRepository,
    private readonly accountMappingRepo: AccountCustomerInvoiceMappingRepository,
  ) {}

  async getVendorsAsync(
    filter?: IVendorListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IVendor[]; total: number }> {
    const items = await this.vendorRepo.getList(filter ?? {}, {
      skipCount,
      maxCount,
    });
    const total = await this.vendorRepo.getCount(filter ?? {});
    return { items, total };
  }

  async getCustomersAsync(
    filter: ICustomerListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: ICustomer[]; total: number }> {
    const items = await this.customerRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.customerRepo.getCount(filter);
    return { items, total };
  }

  async getMainAccountsAsync(
    filter: IMainAccountListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IMainAccount[]; total: number }> {
    const items = await this.mainAccountRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.mainAccountRepo.getCount(filter);
    return { items, total };
  }

  async getBillingCodesAsync(
    filter: IBillingCodeListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IBillingCode[]; total: number }> {
    const items = await this.billingCodeRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.billingCodeRepo.getCount(filter);
    return { items, total };
  }

  async getBillingClassificationsAsync(
    filter: IBillingClassificationListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IBillingClassification[]; total: number }> {
    const items = await this.billingClassificationRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.billingClassificationRepo.getCount(filter);
    return { items, total };
  }

  async getExchangeRatesAsync(
    filter: IExchangeRateListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IExchangeRate[]; total: number }> {
    const items = await this.exchangeRateRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.exchangeRateRepo.getCount(filter);
    return { items, total };
  }

  async getFinancialDimensionsAsync(
    skipCount?: number,
    maxCount?: number,
  ): Promise<IFinancialDimension[]> {
    return this.finDimRepo.getList({ skipCount, maxCount });
  }

  async getFinancialDimensionsWithValuesAsync(
    skipCount?: number,
    maxCount?: number,
  ): Promise<{
    items: IFinancialDimension[];
    count: number;
  }> {
    const total = await this.finDimRepo.count();
    const dimensions = await this.finDimRepo.getList({ skipCount, maxCount });
    if (dimensions.length === 0)
      return {
        items: [],
        count: total,
      };

    const results: IFinancialDimension[] = [];
    for (const dim of dimensions) {
      const values = await this.finDimValRepo.getList({
        financialDimensionKey: dim.financialKey,
      });
      results.push({ ...dim, dimensionValues: values });
    }
    return {
      items: results,
      count: total,
    };
  }

  async getFinancialDimensionWithValuesAsync(
    financialKey: string,
    filter?: { value?: string },
  ): Promise<IFinancialDimensionValue[]> {
    const values = await this.finDimValRepo.getList({
      financialDimensionKey: financialKey,
      value: filter?.value,
    });

    return values;
  }

  async upsertVendorsAsync(
    company: string,
    vendors: ICreateVendor[],
  ): Promise<void> {
    await this.vendorRepo.upsertMany(company, vendors);
  }

  async upsertCustomersAsync(
    company: string,
    customers: ICreateCustomer[],
  ): Promise<void> {
    await this.customerRepo.upsertMany(company, customers);
  }

  async upsertMainAccountsAsync(
    chartNumber: string,
    accounts: ICreateMainAccount[],
  ): Promise<void> {
    await this.mainAccountRepo.upsertMany(chartNumber, accounts);
  }

  async upsertBillingCodesAsync(
    company: string,
    codes: ICreateBillingCode[],
  ): Promise<void> {
    await this.billingCodeRepo.upsertMany(company, codes);
  }

  async upsertBillingClassificationsAsync(
    company: string,
    items: ICreateBillingClassification[],
  ): Promise<void> {
    await this.billingClassificationRepo.upsertMany(company, items);
  }

  async upsertExchangeRatesAsync(rates: ICreateExchangeRate[]): Promise<void> {
    await this.exchangeRateRepo.upsertMany(rates);
  }

  async upsertFinancialDimensionsAsync(
    items: ICreateFinancialDimension[],
  ): Promise<void> {
    await this.finDimRepo.upsertMany(items);
  }

  async upsertFinancialDimensionValuesAsync(
    values: ICreateFinancialDimensionValue[],
  ): Promise<void> {
    await this.finDimValRepo.upsertMany(values);
  }

  async getFinancialDimensionValuesAsync(
    filter: IFinancialDimensionValueListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<IFinancialDimensionValue[]> {
    return this.finDimValRepo.getList(filter, { skipCount, maxCount });
  }

  async upsertAccountMappingsAsync(
    mappings: ICreateAccountCustomerInvoiceMapping[],
  ): Promise<void> {
    await this.accountMappingRepo.upsertMany(mappings);
  }

  async getAccountMappingsAsync(
    filter: IAccountCustomerInvoiceMappingFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IAccountCustomerInvoiceMapping[]; total: number }> {
    const items = await this.accountMappingRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.accountMappingRepo.getCount(filter);
    return { items, total };
  }
}
