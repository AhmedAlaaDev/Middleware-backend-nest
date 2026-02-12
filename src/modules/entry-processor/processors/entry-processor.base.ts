import { QueryBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseOptions } from '@/modules/entry-processor/interfaces/entry-processor-base-options.interface';
import {
  DynDataModel,
  IEntryProcessor,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import {
  DimensionValidationConfig,
  DimensionValidationService,
} from '@/modules/master-data/services/dimension-validation.service';
import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';
import { TaxGroupService } from '@/modules/master-data/services/tax-group.service';

export abstract class EntryProcessorBase implements IEntryProcessor {
  abstract readonly entryProcessorType: EntryProcessorTypes;

  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  protected billingClassifications: Map<string, Array<IBillingCode>> =
    new Map();

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
   * Validates dimensions for a line using this processor's requiredDimensions and options.
   * Processors only pass overrides (dimensionIsRequired, chargeTypeDims, etc.).
   * For sales tax item group validation (non-dimension), use taxGroupService.validateSalesTaxItemGroup directly.
   */
  protected async validateDimensionsForLine(
    line: DynDataModel,
    overrides?: Partial<Omit<DimensionValidationConfig, 'requiredDimensions'>>,
  ): Promise<void> {
    await this.dimensionService.validateDimensions(line, {
      requiredDimensions: this.requiredDimensions,
      chartNumber: this.options?.chartNumber,
      ...overrides,
    });
  }

  protected async getAccountCustomerInvoiceMappings(serviceType: ServiceTypes) {
    const res = await this.queryBus.execute(
      new GetAccountMappingsQuery({ serviceType }),
    );
    return res.items;
  }

  protected fetchExchangeRates(
    dateString: string,
    currency: string,
  ): Promise<{
    exchangeRate: number;
    reportingRate: number;
  }> {
    return this.exchangeRateService.fetchExchangeRates(
      dateString,
      currency,
      this.options.rateType ?? 'default',
    );
  }

  protected queryExchangeRate(
    currency: string,
    date: string,
    toCurrency: 'EGP' | 'USD',
  ): Promise<number> {
    return this.exchangeRateService.queryExchangeRate(
      currency,
      date,
      toCurrency,
      this.options.rateType ?? 'default',
    );
  }
}
