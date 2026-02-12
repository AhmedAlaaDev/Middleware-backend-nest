import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import {
  DimensionKey,
  RequiredDimensionsConfig,
} from '@/modules/entry-processor/types/dimension-key.type';
import { IMainAccount } from '@/modules/master-data/interfaces';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetFinancialDimensionValueQuery } from '@/modules/master-data/queries/get-financial-dimension-values.query';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';

export interface DimensionValidationConfig {
  /** Map of dimension keys to required (true) or optional (false). Keys not present are not validated. */
  requiredDimensions: RequiredDimensionsConfig;
  /** Per-call override for required-ness when it varies by line (e.g. SubVendor: !!line.DimensionModel?.subVendor) */
  dimensionIsRequired?: Partial<Record<DimensionKey, boolean>>;
  validateMainAccount?: boolean;
  chargeTypeDims?: string[];
  /** Chart of accounts to use for main account validation. Defaults to 'Chart of Accounts'. */
  chartNumber?: string;
}

@Injectable()
export class DimensionValidationService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly multiLayerCacheService: MultiLayerCacheService,
  ) {}

  async validateDimensions(
    ar: DynDataModel,
    config: DimensionValidationConfig,
  ): Promise<void> {
    const dimensionsMap = await this.loadDimensionsMap(
      config.requiredDimensions,
    );

    if (config.validateMainAccount) {
      const accounts = await this.getMainAccounts(
        config.chartNumber ?? 'Chart of Accounts',
      );
      this.validateMainAccount(ar, accounts);
    }

    const dimensionKeys = Object.keys(
      config.requiredDimensions,
    ) as DimensionKey[];
    const isRequired = (key: DimensionKey): boolean =>
      config.dimensionIsRequired?.[key] ??
      config.requiredDimensions[key] ??
      true;

    for (const key of dimensionKeys) {
      const values = dimensionsMap.get(key) || [];
      switch (key) {
        case 'MainAccount':
          break;
        case 'Activity':
          this.validateActivityName(ar, values, isRequired(key));
          break;
        case 'CostCenters':
          this.validateCostCenter(ar, values, isRequired(key));
          break;
        case 'BusinessUnit':
          this.validateBusinessUnit(ar, values, isRequired(key));
          break;
        case 'Location':
          this.validateLocation(ar, values, isRequired(key));
          break;
        case 'Customer':
          this.validateCustomerDimension(ar, values, isRequired(key));
          break;
        case 'SubCustomer':
          this.validateSubCustomerDimension(ar, values, isRequired(key));
          break;
        case 'ChargeType':
          if (config.chargeTypeDims?.length) {
            this.validateChargeTypeDimension(
              ar,
              config.chargeTypeDims,
              isRequired(key),
            );
          }
          break;
        case 'SalesMan':
          this.validateSalesMan(ar, values, isRequired(key));
          break;
        case 'CoordinatorMan':
          this.validateCoordinatorMan(ar, values, isRequired(key));
          break;
        case 'FreightType':
          this.validateFreightType(ar, values, isRequired(key));
          break;
        case 'Direction':
          this.validateDirection(ar, values, isRequired(key));
          break;
        case 'TruckerType':
          this.validateTruckerType(ar, values, isRequired(key));
          break;
        case 'TruckNumber':
          this.validateTruckNumber(ar, values, isRequired(key));
          break;
        case 'Vendor':
          this.validateVendor(ar, values, isRequired(key));
          break;
        case 'SubVendor':
          this.validateSubVendor(ar, values, isRequired(key));
          break;
        case 'Worker':
          this.validateWorker(ar, values, isRequired(key));
          break;
      }
    }
  }

  private async loadDimensionsMap(
    requiredDimensions: RequiredDimensionsConfig,
  ): Promise<Map<DimensionKey, IFinancialDimensionValue[]>> {
    const map = new Map<DimensionKey, IFinancialDimensionValue[]>();
    for (const key of Object.keys(requiredDimensions) as DimensionKey[]) {
      if (key === 'MainAccount') continue;
      const fetchKey = key === 'SubCustomer' ? 'Customer' : key;
      const values = await this.getDimensionValues(fetchKey);
      map.set(key, values);
    }
    return map;
  }

  private async getMainAccounts(
    chartNumber: string = 'Chart of Accounts',
  ): Promise<IMainAccount[]> {
    const cacheKey = `main-accounts:${chartNumber}`;
    const result = await this.multiLayerCacheService.get(cacheKey, async () => {
      const res = await this.queryBus.execute(
        new GetMainAccountsQuery({ chartNumber }),
      );
      return res?.items || [];
    });
    return result;
  }

  async getDimensionValues(
    financialKey: string,
  ): Promise<IFinancialDimensionValue[]> {
    const cacheKey = `dimension-values:${financialKey}`;
    return this.multiLayerCacheService.get(cacheKey, async () => {
      const values = await this.queryBus.execute(
        new GetFinancialDimensionValueQuery(financialKey),
      );
      return values || [];
    });
  }

  /**
   * Shared validation for dimension fields that follow the standard pattern:
   * - Required check (empty or '000')
   * - Value must exist in allowed dimensions (partial match via includes)
   */
  private validateDimensionField(
    ar: DynDataModel,
    rawValue: string | undefined,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
    errorKey: string,
    label: string,
  ): void {
    const value = (rawValue ?? '').trim().toLowerCase();
    if (isRequired && (!value || value === '000')) {
      ar.AddError(errorKey, `${label} is required`);
      return;
    }
    if (
      value &&
      !dimensions.some((d) => (d?.value || '').toLowerCase().includes(value))
    ) {
      ar.AddError(
        errorKey,
        `The dimension ${rawValue ?? value} does not exist in the system.`,
      );
    }
  }

  private validateMainAccount(
    ar: DynDataModel,
    accounts: Array<{ accountNumber: string }>,
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (!dimensionsModel?.mainAccount) {
      ar.AddError('MainAccount', 'Main Account is required');
      return;
    }
    if (
      !accounts.some((a) =>
        a.accountNumber
          .toLowerCase()
          .includes(dimensionsModel.mainAccount?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'MainAccount',
        `The main account ${dimensionsModel.mainAccount} does not exist in the system.`,
      );
    }
  }

  private validateCustomerDimension(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.customer,
      dimensions,
      isRequired,
      'CustomerDimensions',
      'Customer',
    );
  }

  private validateSubCustomerDimension(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.subCustomer,
      dimensions,
      isRequired,
      'SubCustomerDimensions',
      'SubCustomer',
    );
  }

  private static normalizeChargeTypeForMatch(s: string): string {
    return s
      .toLowerCase()
      .replace(/-of|-or/g, '')
      .trim();
  }

  private validateChargeTypeDimension(
    ar: DynDataModel,
    allowedValues: string[],
    isRequired: boolean,
  ): void {
    this.validateDimensionFieldFromStrings(
      ar,
      ar.DimensionModel?.chargeType,
      allowedValues,
      isRequired,
      'ChargeTypeDimensions',
      'ChargeType',
      (s) => DimensionValidationService.normalizeChargeTypeForMatch(s),
    );
  }

  /**
   * Validates a dimension field against a list of allowed strings.
   * Uses exact match after optional normalizer (e.g. ChargeType needs -of/-or stripped).
   */
  private validateDimensionFieldFromStrings(
    ar: DynDataModel,
    rawValue: string | undefined,
    allowedValues: string[],
    isRequired: boolean,
    errorKey: string,
    label: string,
    normalizer: (s: string) => string = (s) => s.toLowerCase().trim(),
  ): void {
    const value = (rawValue ?? '').trim();
    if (isRequired && (!value || value.toLowerCase() === '000')) {
      ar.AddError(errorKey, `${label} is required`);
      return;
    }
    if (
      value &&
      !allowedValues.some((d) => normalizer(d) === normalizer(value))
    ) {
      ar.AddError(
        errorKey,
        `The dimension ${rawValue ?? value} does not exist in the system.`,
      );
    }
  }

  private validateActivityName(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.activityName,
      dimensions,
      isRequired,
      'ActivityNameDimensions',
      'ActivityName',
    );
  }

  private validateCostCenter(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.costCenter,
      dimensions,
      isRequired,
      'CostCenterDimensions',
      'CostCenter',
    );
  }

  private validateBusinessUnit(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.businessUnit,
      dimensions,
      isRequired,
      'BusinessUnitDimensions',
      'BusinessUnit',
    );
  }

  private validateLocation(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.location,
      dimensions,
      isRequired,
      'LocationDimensions',
      'Location',
    );
  }

  private validateFreightType(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.freightType,
      dimensions,
      isRequired,
      'FreightTypeDimensions',
      'FreightType',
    );
  }

  private validateSalesMan(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.salesMan,
      dimensions,
      isRequired,
      'SalesManDimensions',
      'SalesMan',
    );
  }

  private validateTruckerType(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.truckerType,
      dimensions,
      isRequired,
      'TruckerTypeDimensions',
      'TruckerType',
    );
  }

  private validateTruckNumber(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.truckNumber,
      dimensions,
      isRequired,
      'TruckNumberDimensions',
      'TruckNumber',
    );
  }

  private validateDirection(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.direction,
      dimensions,
      isRequired,
      'DirectionDimensions',
      'Direction',
    );
  }

  private validateCoordinatorMan(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.coordinatorMan,
      dimensions,
      isRequired,
      'CoordinatorManDimensions',
      'CoordinatorMan',
    );
  }

  private validateVendor(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.vendor,
      dimensions,
      isRequired,
      'VendorDimensions',
      'Vendor',
    );
  }

  private validateSubVendor(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.subVendor,
      dimensions,
      isRequired,
      'SubVendorDimensions',
      'SubVendor',
    );
  }

  private validateWorker(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.worker,
      dimensions,
      isRequired,
      'WorkerDimensions',
      'Worker',
    );
  }
}
