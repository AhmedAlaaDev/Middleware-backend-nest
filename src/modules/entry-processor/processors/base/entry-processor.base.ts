import { QueryBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseOptions } from '@/modules/entry-processor/interfaces/entry-processor-base-options.interface';
import {
  DynDataModel,
  IEntryProcessor,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import {
  DimensionValidationConfig,
  DimensionValidationService,
} from '@/modules/master-data/services/dimension-validation.service';
import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';

export abstract class EntryProcessorBase implements IEntryProcessor {
  abstract readonly entryProcessorType: EntryProcessorTypes;

  abstract readonly requiredDimensions: RequiredDimensionsConfig;

  protected billingClassifications: Map<string, Array<IBillingCode>> =
    new Map();

  protected readonly queryBus: QueryBus;
  protected readonly exchangeRateService: ExchangeRateService;
  protected readonly utilsService: EntryProcessorUtilsService;
  protected readonly dimensionService: DimensionValidationService;

  constructor(protected readonly options: EntryProcessorBaseOptions) {
    this.queryBus = options.dependencies.queryBus;
    this.exchangeRateService = options.dependencies.exchangeRateService;
    this.utilsService = options.dependencies.utilsService;
    this.dimensionService = options.dependencies.dimensionService;
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

  protected parseDimensionString(
    dimensionString: string,
  ): AccountDimensionsModel {
    return this.utilsService.parseDimensionString(dimensionString);
  }

  protected toDimensionString(
    dimensionsModel: AccountDimensionsModel | null,
  ): string {
    return this.utilsService.toDimensionString(dimensionsModel);
  }

  protected toDimensionStringWithSegments(
    dimensionsModel: AccountDimensionsModel | null,
    requiredSegments: number,
  ): string {
    return this.utilsService.toDimensionStringWithSegments(
      dimensionsModel,
      requiredSegments,
    );
  }

  protected toDate(input: unknown): Date | null {
    return this.utilsService.toDate(input);
  }

  protected formatMonthYear(dateStr: string): string {
    return this.utilsService.formatMonthYear(dateStr);
  }

  protected toMonthKey(dateStr: string): string {
    return this.utilsService.toMonthKey(dateStr);
  }

  protected formatDocumentNumber(docNumber: string): string {
    return this.utilsService.formatDocumentNumber(docNumber);
  }

  /**
   * Validates dimensions for a line using this processor's requiredDimensions and options.
   * Processors only pass overrides (validateMainAccount, dimensionIsRequired, etc.).
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

  protected async getFinancialDimensionValues(
    financialKey: string,
  ): Promise<IFinancialDimensionValue[]> {
    return this.dimensionService.getDimensionValues(financialKey);
  }

  protected formatVoucherNumber(voucher: number, prefix: string): string {
    return this.utilsService.formatVoucherNumber(voucher, prefix);
  }

  protected formatBatchNumber(batch: number, prefix?: string): string {
    return this.utilsService.formatBatchNumber(batch, prefix);
  }

  protected formatFreeTextNumberWithSuffix(
    invoiceNumber: string,
    billingClassId: string,
    isCreditNote: boolean,
  ): string {
    return this.utilsService.formatFreeTextNumberWithSuffix(
      invoiceNumber,
      billingClassId,
      isCreditNote,
    );
  }

  protected normalizeCurrencyCode(currency?: string | null): string {
    return this.utilsService.normalizeCurrencyCode(currency);
  }

  protected normalizeCompanyCode(company?: string | null): string {
    return this.utilsService.normalizeCompanyCode(company);
  }

  protected normalizeTransactionType(transactionType?: string | null): string {
    return this.utilsService.normalizeTransactionType(transactionType);
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
