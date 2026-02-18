import { Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import {
  FreeTextInvoiceLookupResult,
  GetByInvoiceNumbersOptions,
} from '@/modules/d365fo/types';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  IEntryProcessor,
  RawDataModel,
  DynDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import {
  DimensionKey,
  RequiredDimensionsConfig,
} from '@/modules/entry-processor/types/dimension-key.type';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IVendor } from '@/modules/master-data/interfaces';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import {
  GetCustomersQuery,
  GetVendorsQuery,
} from '@/modules/master-data/queries';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { GetExchangeRatesQuery } from '@/modules/master-data/queries/get-exchange-rates.query';
import { GetFinancialDimensionValueQuery } from '@/modules/master-data/queries/get-financial-dimension-values.query';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import {
  DimensionValidationConfig,
  DimensionValidationService,
} from '@/modules/master-data/services/dimension-validation.service';
import {
  ExchangeRateMap,
  ExchangeRateService,
} from '@/modules/master-data/services/exchange-rate.service';
import { TaxGroupService } from '@/modules/master-data/services/tax-group.service';

export interface WarmupProcessorDataOptions {
  /**
   * Whether to fetch dimensions from the database.
   * @default true
   */
  dimensions?: boolean;
  /**
   * Whether to fetch main accounts from the database.
   * @default true
   */
  mainAccount?: boolean;
  /**
   * Whether to fetch exchange rates from the database.
   * @default true
   */
  exchangeRates?: boolean;
  /**
   * Whether to fetch customer names from the database.
   * @default false
   */
  customerNames?: boolean;
  /**
   * Whether to fetch vendor tax number and terms of payment from the database.
   * @default false
   */
  vendorTaxNumberAndTermsOfPayment?: boolean;
}

const DEFAULT_WARMUP_OPTIONS: Required<WarmupProcessorDataOptions> = {
  dimensions: true,
  mainAccount: true,
  exchangeRates: true,
  customerNames: false,
  vendorTaxNumberAndTermsOfPayment: false,
};

interface EntryProcessorBaseOptions {
  dependencies: EntryProcessorBaseDependencies;
  rateType?: string;
  chartNumber?: string;
}

export abstract class EntryProcessorBase implements IEntryProcessor {
  protected readonly baseLogger = new Logger(EntryProcessorBase.name);

  abstract readonly entryProcessorType: EntryProcessorTypes;

  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  protected billingClassifications: Map<string, Array<IBillingCode>> =
    new Map();

  protected rateType: string;
  protected chartNumber: string;

  protected dimensionsMap: Map<DimensionKey, Set<string>> | null = null;
  protected accountNumberSet: Set<string> | null = null;
  protected exchangeRateMap: ExchangeRateMap | null = null;
  protected customerNameMap: Map<string, string> | null = null;
  protected vendorTaxNumberAndTermsOfPaymentMap: Map<
    string,
    { taxNumber: string; termsOfPayment: string }
  > | null = null;
  protected freeTextInvoiceMap: Map<
    string,
    FreeTextInvoiceLookupResult[]
  > | null = null;
  protected unbalancedUniqueIds: Set<string> = new Set();

  protected readonly queryBus: QueryBus;
  protected readonly exchangeRateService: ExchangeRateService;
  protected readonly utilsService: EntryProcessorUtilsService;
  protected readonly dimensionService: DimensionValidationService;
  protected readonly taxGroupService: TaxGroupService;
  protected readonly freeTextInvoiceService: FreeTextInvoiceService;

  private _company: string;

  constructor(protected readonly options: EntryProcessorBaseOptions) {
    this.rateType = options.rateType ?? 'default';
    this.chartNumber = options.chartNumber ?? 'Chart of Accounts';
    this._company = 'm-p';
    this.queryBus = options.dependencies.queryBus;
    this.exchangeRateService = options.dependencies.exchangeRateService;
    this.utilsService = options.dependencies.utilsService;
    this.dimensionService = options.dependencies.dimensionService;
    this.taxGroupService = options.dependencies.taxGroupService;
    this.freeTextInvoiceService = options.dependencies.freeTextInvoiceService;
  }

  protected set company(company: string) {
    this._company = company;
  }

  protected get company(): string {
    return this._company;
  }

  abstract formatAndEnrichAsync(
    data: RawDataModel[] | EntryRawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[] | EntryDynDataModel[]>;

  abstract validateAsync(
    data: DynDataModel[] | EntryDynDataModel[],
    company: string,
    billingClassId?: string,
  ):
    | Promise<DynDataModel[] | EntryDynDataModel[]>
    | DynDataModel[]
    | EntryDynDataModel[];

  abstract insertIntoDynamicsAsync(
    data: DynDataModel[] | EntryDynDataModel[],
    company: string,
  ): Promise<void>;

  protected sortRawDataByLineNumber<T extends EntryRawDataModel>(
    lines: T[],
  ): T[] {
    return [...lines].sort(
      (a, b) => Number(a.LINENUMBER) - Number(b.LINENUMBER),
    );
  }

  protected buildUniqueIdMap<T extends EntryRawDataModel>(
    lines: T[],
  ): Map<string, T[]> {
    const uniqueIdMap: Map<string, T[]> = new Map();

    for (const line of lines) {
      if (!line.UniqueId) {
        this.baseLogger.error(
          `[${this.constructor.name}] Line has no UniqueId: ${JSON.stringify(line, null, 2)}`,
        );
        continue;
      }

      const uniqueId = String(line.UniqueId);
      if (!uniqueIdMap.has(uniqueId)) {
        uniqueIdMap.set(uniqueId, []);
      }
      uniqueIdMap.get(uniqueId)!.push(line);
    }

    return uniqueIdMap;
  }

  protected checkInvoiceBalancedAfterFx(
    invoiceMap: Map<string, EntryRawDataModel[]>,
  ): Set<string> {
    return this.utilsService.checkInvoiceBalancedAfterFx(
      invoiceMap,
      this.unbalancedUniqueIds,
    );
  }

  /**
   * Preloads dimensions, main accounts, and exchange rates into memory.
   * Call at the start of formatAndEnrichAsync (before per-line loops).
   */
  protected async warmupProcessorData(
    opts?: WarmupProcessorDataOptions,
  ): Promise<void> {
    const options = { ...DEFAULT_WARMUP_OPTIONS, ...opts };
    const processorName = this.constructor.name;
    const startMs = Date.now();

    this.baseLogger.debug(
      `[${processorName}] warmupProcessorData starting: dimensions=${options.dimensions}, mainAccount=${options.mainAccount}, exchangeRates=${options.exchangeRates}`,
    );

    if (options.dimensions) {
      const dimStart = Date.now();
      this.dimensionsMap = await this.fetchDimensionValues(
        this.requiredDimensions,
      );
      this.baseLogger.debug(
        `[${processorName}] Dimensions loaded in ${Date.now() - dimStart}ms, keys: ${this.dimensionsMap.size}`,
      );
    }

    if (options.mainAccount) {
      const accStart = Date.now();
      this.accountNumberSet = await this.fetchMainAccounts(this.chartNumber);
      this.baseLogger.debug(
        `[${processorName}] Main accounts loaded in ${Date.now() - accStart}ms, count: ${this.accountNumberSet.size}`,
      );
    }

    if (options.exchangeRates) {
      const exStart = Date.now();
      this.exchangeRateMap = this.exchangeRateMap ?? new Map();
      await this.fetchExchangeRatesData(this.rateType);
      this.baseLogger.debug(
        `[${processorName}] Exchange rates loaded in ${Date.now() - exStart}ms, rateTypes: ${this.exchangeRateMap.size}`,
      );
    }

    if (options.customerNames) {
      const customerStart = Date.now();
      this.customerNameMap = await this.fetchCustomerNames(this.company);
      this.baseLogger.debug(
        `[${processorName}] Customer names loaded in ${Date.now() - customerStart}ms, count: ${this.customerNameMap.size}`,
      );
    }

    if (options.vendorTaxNumberAndTermsOfPayment) {
      const vendorStart = Date.now();
      this.vendorTaxNumberAndTermsOfPaymentMap =
        await this.fetchVendorTaxNumberAndTermsOfPayment(this.company);
      this.baseLogger.debug(
        `[${processorName}] Vendor tax number and terms of payment loaded in ${Date.now() - vendorStart}ms, count: ${this.vendorTaxNumberAndTermsOfPaymentMap.size}`,
      );
    }

    this.baseLogger.debug(
      `[${processorName}] warmupProcessorData completed in ${Date.now() - startMs}ms`,
    );
  }

  protected async fetchDimensionValues(
    requiredDimensions: RequiredDimensionsConfig,
  ): Promise<Map<DimensionKey, Set<string>>> {
    const dimensionKeys = Object.keys(requiredDimensions) as DimensionKey[];
    const uniqueFetchKeys = new Set<string>();
    for (const key of dimensionKeys) {
      if (key === 'MainAccount') continue;
      const fetchKey = key === 'SubCustomer' ? 'Customer' : key;
      uniqueFetchKeys.add(fetchKey);
    }

    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching dimension values for keys: ${Array.from(uniqueFetchKeys).join(', ')}`,
    );

    const fetchKeyToValues = new Map<string, IFinancialDimensionValue[]>();
    for (const fetchKey of uniqueFetchKeys) {
      const values = await this.queryBus.execute(
        new GetFinancialDimensionValueQuery(fetchKey),
      );
      fetchKeyToValues.set(fetchKey, values ?? []);
    }

    return this.dimensionService.buildDimensionsMap(
      fetchKeyToValues,
      requiredDimensions,
    );
  }

  protected async fetchMainAccounts(chartNumber: string): Promise<Set<string>> {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching main accounts for chart: ${chartNumber}`,
    );

    const pageSize = 1500;
    let skipCount = 0;
    const allItems: { accountNumber?: string }[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await this.queryBus.execute(
        new GetMainAccountsQuery({ chartNumber }, skipCount, pageSize),
      );
      const pageItems = res?.items ?? [];
      allItems.push(...pageItems);
      if (pageItems.length < pageSize) {
        hasMore = false;
      } else {
        skipCount += pageSize;
      }
    }

    return new Set(
      allItems
        .map((a) => a.accountNumber?.toLowerCase().trim())
        .filter(Boolean) as string[],
    );
  }

  protected async fetchCustomerNames(
    company: string,
  ): Promise<Map<string, string>> {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching customer names for company: ${company}`,
    );

    const pageSize = 1500;
    let skipCount = 0;
    const allItems: { customerAccount?: string; name?: string }[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await this.queryBus.execute(
        new GetCustomersQuery({ company }, skipCount, pageSize),
      );
      const pageItems = res?.items ?? [];
      allItems.push(...pageItems);
      if (pageItems.length < pageSize) {
        hasMore = false;
      } else {
        skipCount += pageSize;
      }
    }

    const customerNameMap = new Map<string, string>();

    for (const item of allItems) {
      const customerAccount = item?.customerAccount?.toLowerCase()?.trim();
      const name = item?.name?.trim();

      if (!name || !customerAccount) continue;
      customerNameMap.set(customerAccount, name);
    }

    return customerNameMap;
  }

  protected getCustomerName(customerAccount: string): string | undefined {
    if (!this.customerNameMap) {
      throw new Error(
        'warmupProcessorData must be called before getCustomerName',
      );
    }

    return this.customerNameMap.get(customerAccount?.toLowerCase().trim());
  }

  protected async fetchVendorTaxNumberAndTermsOfPayment(
    company: string,
  ): Promise<Map<string, { taxNumber: string; termsOfPayment: string }>> {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching vendor tax number and terms of payment for company: ${company}`,
    );

    const pageSize = 1500;
    let skipCount = 0;
    const allItems: IVendor[] = [];
    let hasMore = true;

    while (hasMore) {
      const vendorRes = await this.queryBus.execute(
        new GetVendorsQuery({ company }, skipCount, pageSize),
      );
      const pageItems = vendorRes?.items ?? [];
      allItems.push(...pageItems);
      if (pageItems.length < pageSize) {
        hasMore = false;
      } else {
        skipCount += pageSize;
      }
    }

    const vendorTaxNumberAndTermsOfPaymentMap = new Map<
      string,
      { taxNumber: string; termsOfPayment: string }
    >();

    for (const item of allItems) {
      const vendorAccountNumber = item.vendorAccountNumber
        ?.toLowerCase()
        .trim();

      if (!vendorAccountNumber) continue;

      vendorTaxNumberAndTermsOfPaymentMap.set(vendorAccountNumber, {
        taxNumber: item.salesTaxGroupCode || '',
        termsOfPayment: item.defaultPaymentTermsName || '',
      });
    }

    return vendorTaxNumberAndTermsOfPaymentMap;
  }

  protected getVendorTaxNumberAndTermsOfPayment(vendorAccount: string): {
    taxNumber: string;
    termsOfPayment: string;
  } {
    if (!this.vendorTaxNumberAndTermsOfPaymentMap) {
      throw new Error(
        'warmupProcessorData must be called before getVendorTaxNumberAndTermsOfPayment',
      );
    }

    const vendorAccountNumber = vendorAccount.toLowerCase().trim();

    return (
      this.vendorTaxNumberAndTermsOfPaymentMap.get(vendorAccountNumber) ?? {
        taxNumber: '',
        termsOfPayment: '',
      }
    );
  }

  /**
   * Fetches raw dimension values for a financial key. Use when processor needs
   * IFinancialDimensionValue[] (e.g. for grouping by CostCenter). Direct DB via QueryBus.
   */
  protected async fetchDimensionValuesRaw(
    financialKey: string,
  ): Promise<IFinancialDimensionValue[]> {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching raw dimension values for: ${financialKey}`,
    );

    const values = await this.queryBus.execute(
      new GetFinancialDimensionValueQuery(financialKey),
    );
    return values ?? [];
  }

  protected async fetchExchangeRatesData(rateType: string): Promise<void> {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching exchange rates for rateType: ${rateType}`,
    );

    if (!this.exchangeRateMap) {
      this.exchangeRateMap = new Map();
    }
    const result = await this.queryBus.execute(
      new GetExchangeRatesQuery({ rateTypeName: rateType }, 0, 10000),
    );
    const items = result?.items ?? [];
    const pairIndex = this.exchangeRateService.buildRatesIndexByPair(items);
    this.exchangeRateMap.set(rateType, pairIndex);
  }

  /**
   * Validates dimensions for a line using this processor's requiredDimensions and options.
   * Sync — call without await. Requires warmupProcessorData to have been called first.
   */
  protected validateDimensionsForLine(
    line: DynDataModel,
    overrides?: Partial<Omit<DimensionValidationConfig, 'requiredDimensions'>>,
  ): void {
    if (!this.dimensionsMap || !this.accountNumberSet) {
      throw new Error(
        'warmupProcessorData must be called before validateDimensionsForLine',
      );
    }
    this.dimensionService.validateDimensions(
      line,
      {
        requiredDimensions: this.requiredDimensions,
        chartNumber: this.chartNumber,
        ...overrides,
      },
      {
        dimensionsMap: this.dimensionsMap,
        accountNumberSet: this.accountNumberSet,
      },
    );
  }

  protected async getAccountCustomerInvoiceMappings(serviceType: ServiceTypes) {
    this.baseLogger.debug(
      `[${this.constructor.name}] Fetching account mappings for serviceType: ${serviceType}`,
    );

    const res = await this.queryBus.execute(
      new GetAccountMappingsQuery({ serviceType }),
    );
    return res.items;
  }

  protected fetchExchangeRates(
    dateString: string,
    currency: string,
  ): { exchangeRate: number; reportingRate: number } {
    if (!this.exchangeRateMap) {
      throw new Error(
        'warmupProcessorData must be called before fetchExchangeRates',
      );
    }
    return this.exchangeRateService.fetchExchangeRates(
      this.exchangeRateMap,
      this.rateType,
      dateString,
      currency,
    );
  }

  protected queryExchangeRate(
    currency: string,
    date: string,
    toCurrency: 'EGP' | 'USD',
  ): number {
    if (!this.exchangeRateMap) {
      throw new Error(
        'warmupProcessorData must be called before queryExchangeRate',
      );
    }
    return this.exchangeRateService.queryExchangeRate(
      this.exchangeRateMap,
      this.rateType,
      currency,
      date,
      toCurrency,
    );
  }

  /**
   * Fetches free text invoices by invoice numbers (not by date range) so that
   * invoices with older dates are still found. Uses batch lookup with 10 chunks
   * in parallel.
   */
  protected async fetchFreeTextInvoices(options: {
    invoiceNumbers: string[];
  }): Promise<Map<string, FreeTextInvoiceLookupResult[]>> {
    const invoiceNumbers = [
      ...new Set(
        options.invoiceNumbers
          .map((n) => (n ?? '').trim())
          .filter((n): n is string => Boolean(n)),
      ),
    ];

    if (invoiceNumbers.length === 0) {
      this.baseLogger.debug(
        'No invoice numbers to fetch; skipping free text invoice lookup',
      );
      this.freeTextInvoiceMap = new Map();
      return this.freeTextInvoiceMap;
    }

    this.baseLogger.debug(
      `Fetching ${invoiceNumbers.length} free text invoices by number (concurrency=10)`,
    );

    const params: GetByInvoiceNumbersOptions = {
      company: this.company,
      invoiceNumbers,
      concurrency: 10,
    };
    const results =
      await this.freeTextInvoiceService.getByInvoiceNumbers(params);

    if (!this.freeTextInvoiceMap) {
      this.freeTextInvoiceMap = new Map();
    }
    for (const result of results) {
      if (!result.exists) continue;
      const key = (result.invoiceNumber ?? '').trim().toLowerCase();
      const arr = this.freeTextInvoiceMap.get(key) ?? [];
      arr.push(result);
      this.freeTextInvoiceMap.set(key, arr);
    }

    const mapSize = this.freeTextInvoiceMap.size;
    const duplicateCount = [...this.freeTextInvoiceMap.values()].filter(
      (arr) => arr.length > 1,
    ).length;
    if (results.length !== mapSize || duplicateCount > 0) {
      this.baseLogger.debug(
        `Free text invoices: ${results.length} lookup results → ${mapSize} invoice number(s), ${duplicateCount} with duplicates`,
      );
    }

    return this.freeTextInvoiceMap;
  }
}
