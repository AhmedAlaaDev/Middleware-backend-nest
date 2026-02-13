import { Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseOptions } from '@/modules/entry-processor/interfaces/entry-processor-base-options.interface';
import {
  DynDataModel,
  IEntryProcessor,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import {
  DimensionKey,
  RequiredDimensionsConfig,
} from '@/modules/entry-processor/types/dimension-key.type';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
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
  dimensions?: boolean;
  mainAccount?: boolean;
  exchangeRates?: boolean;
}

const DEFAULT_WARMUP_OPTIONS: Required<WarmupProcessorDataOptions> = {
  dimensions: true,
  mainAccount: true,
  exchangeRates: true,
};

export abstract class EntryProcessorBase implements IEntryProcessor {
  protected readonly baseLogger = new Logger(EntryProcessorBase.name);

  abstract readonly entryProcessorType: EntryProcessorTypes;

  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  protected billingClassifications: Map<string, Array<IBillingCode>> =
    new Map();

  protected dimensionsMap: Map<DimensionKey, Set<string>> | null = null;
  protected accountNumberSet: Set<string> | null = null;
  protected exchangeRateMap: ExchangeRateMap | null = null;

  protected readonly queryBus: QueryBus;
  protected readonly exchangeRateService: ExchangeRateService;
  protected readonly utilsService: EntryProcessorUtilsService;
  protected readonly dimensionService: DimensionValidationService;
  protected readonly taxGroupService: TaxGroupService;

  constructor(protected readonly options: EntryProcessorBaseOptions) {
    this.queryBus = options.dependencies.queryBus;
    this.exchangeRateService = options.dependencies.exchangeRateService;
    this.utilsService = options.dependencies.utilsService;
    this.dimensionService = options.dependencies.dimensionService;
    this.taxGroupService = options.dependencies.taxGroupService;
  }

  abstract formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void>;

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
      this.accountNumberSet = await this.fetchMainAccounts(
        this.options?.chartNumber ?? 'Chart of Accounts',
      );
      this.baseLogger.debug(
        `[${processorName}] Main accounts loaded in ${Date.now() - accStart}ms, count: ${this.accountNumberSet.size}`,
      );
    }

    if (options.exchangeRates) {
      const exStart = Date.now();
      this.exchangeRateMap = this.exchangeRateMap ?? new Map();
      await this.fetchExchangeRatesData(this.options?.rateType ?? 'default');
      this.baseLogger.debug(
        `[${processorName}] Exchange rates loaded in ${Date.now() - exStart}ms, rateTypes: ${this.exchangeRateMap.size}`,
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
        chartNumber: this.options?.chartNumber,
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
      this.options?.rateType ?? 'default',
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
      this.options?.rateType ?? 'default',
      currency,
      date,
      toCurrency,
    );
  }
}
