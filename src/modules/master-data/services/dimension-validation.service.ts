import { Injectable } from '@nestjs/common';

import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import {
  DimensionKey,
  RequiredDimensionsConfig,
} from '@/modules/entry-processor/types/dimension-key.type';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';

export interface DimensionValidationConfig {
  /** Map of dimension keys to required (true) or optional (false). Keys not present are not validated. */
  requiredDimensions: RequiredDimensionsConfig;
  /** Per-call override for required-ness when it varies by line (e.g. SubVendor: !!line.DimensionModel?.subVendor) */
  dimensionIsRequired?: Partial<Record<DimensionKey, boolean>>;

  chargeTypeDims?: string[];
  /** Chart of accounts to use for main account validation. Defaults to 'Chart of Accounts'. */
  chartNumber?: string;
}

export interface ValidationPreload {
  dimensionsMap: Map<DimensionKey, Set<string>>;
  accountNumberSet: Set<string>;
}

@Injectable()
export class DimensionValidationService {
  /**
   * Builds dimensions map from raw fetch results. SubCustomer and Customer share fetchKey 'Customer'
   * so base fetches once and both map entries get the same valueSet (no double DB hit).
   */
  buildDimensionsMap(
    fetchKeyToValues: Map<string, IFinancialDimensionValue[]>,
    requiredDimensions: RequiredDimensionsConfig,
  ): Map<DimensionKey, Set<string>> {
    const map = new Map<DimensionKey, Set<string>>();
    const fetchKeyToValueSet = new Map<string, Set<string>>();

    const dimensionKeys = Object.keys(requiredDimensions) as DimensionKey[];

    for (const key of dimensionKeys) {
      if (key === 'MainAccount') continue;

      const fetchKey = key === 'SubCustomer' ? 'Customer' : key;

      let valueSet = fetchKeyToValueSet.get(fetchKey);
      if (valueSet === undefined) {
        const values = fetchKeyToValues.get(fetchKey) ?? [];
        valueSet = new Set(
          values
            .map((v) => (v?.value || '').toLowerCase().trim())
            .filter(Boolean),
        );
        fetchKeyToValueSet.set(fetchKey, valueSet);
      }

      map.set(key, valueSet);
    }

    return map;
  }

  validateDimensions(
    ar: DynDataModel,
    config: DimensionValidationConfig,
    preloaded: ValidationPreload,
  ): void {
    const { dimensionsMap, accountNumberSet } = preloaded;

    const dimensionKeys = Object.keys(
      config.requiredDimensions,
    ) as DimensionKey[];
    const isRequired = (key: DimensionKey): boolean =>
      config.dimensionIsRequired?.[key] ??
      config.requiredDimensions[key] ??
      true;

    for (const key of dimensionKeys) {
      const valueSet = dimensionsMap.get(key) ?? new Set<string>();
      switch (key) {
        case 'MainAccount':
          if (ar.AccountType === 'Ledger') {
            this.validateMainAccount(ar, accountNumberSet, isRequired(key));
          }
          break;
        case 'Activity':
          this.validateActivityName(ar, valueSet, isRequired(key));
          break;
        case 'CostCenters':
          this.validateCostCenter(ar, valueSet, isRequired(key));
          break;
        case 'BusinessUnit':
          this.validateBusinessUnit(ar, valueSet, isRequired(key));
          break;
        case 'Location':
          this.validateLocation(ar, valueSet, isRequired(key));
          break;
        case 'Customer':
          this.validateCustomerDimension(ar, valueSet, isRequired(key));
          break;
        case 'SubCustomer':
          this.validateSubCustomerDimension(ar, valueSet, isRequired(key));
          break;
        case 'ChargeType': {
          const allowedChargeTypes =
            (config.chargeTypeDims?.length ?? 0) > 0
              ? config.chargeTypeDims!
              : Array.from(valueSet);
          if (allowedChargeTypes.length > 0) {
            this.validateChargeTypeDimension(
              ar,
              allowedChargeTypes,
              isRequired(key),
            );
          }
          break;
        }
        case 'SalesMan':
          this.validateSalesMan(ar, valueSet, isRequired(key));
          break;
        case 'CoordinatorMan':
          this.validateCoordinatorMan(ar, valueSet, isRequired(key));
          break;
        case 'FreightType':
          this.validateFreightType(ar, valueSet, isRequired(key));
          break;
        case 'Direction':
          this.validateDirection(ar, valueSet, isRequired(key));
          break;
        case 'TruckerType':
          this.validateTruckerType(ar, valueSet, isRequired(key));
          break;
        case 'TruckNumber':
          this.validateTruckNumber(ar, valueSet, isRequired(key));
          break;
        case 'Vendor':
          this.validateVendor(ar, valueSet, isRequired(key));
          break;
        case 'SubVendor':
          this.validateSubVendor(ar, valueSet, isRequired(key));
          break;
        case 'Worker':
          this.validateWorker(ar, valueSet, isRequired(key));
          break;
      }
    }
  }

  /**
   * Shared validation for dimension fields that follow the standard pattern:
   * - Required check (empty or '000')
   * - Value must exist in allowed dimensions (exact match, case-insensitive)
   */
  private validateDimensionField(
    ar: DynDataModel,
    rawValue: string | undefined,
    valueSet: Set<string>,
    isRequired: boolean,
    errorKey: string,
    label: string,
  ): void {
    const value = (rawValue ?? '').trim().toLowerCase();
    if (isRequired && (!value || value === '000')) {
      ar.AddError(errorKey, `${label} is required`);
      return;
    }
    if (value && !valueSet.has(value)) {
      ar.AddError(
        errorKey,
        `The dimension ${rawValue ?? value} does not exist in the system.`,
      );
    }
  }

  private validateMainAccount(
    ar: DynDataModel,
    accountNumberSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.mainAccount,
      accountNumberSet,
      isRequired,
      'MainAccountDimensions',
      'Main Account',
    );
  }

  private validateCustomerDimension(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.customer,
      valueSet,
      isRequired,
      'CustomerDimensions',
      'Customer',
    );
  }

  private validateSubCustomerDimension(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.subCustomer,
      valueSet,
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
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.activityName,
      valueSet,
      isRequired,
      'ActivityNameDimensions',
      'ActivityName',
    );
  }

  private validateCostCenter(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.costCenter,
      valueSet,
      isRequired,
      'CostCenterDimensions',
      'CostCenter',
    );
  }

  private validateBusinessUnit(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.businessUnit,
      valueSet,
      isRequired,
      'BusinessUnitDimensions',
      'BusinessUnit',
    );
  }

  private validateLocation(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.location,
      valueSet,
      isRequired,
      'LocationDimensions',
      'Location',
    );
  }

  private validateFreightType(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.freightType,
      valueSet,
      isRequired,
      'FreightTypeDimensions',
      'FreightType',
    );
  }

  private validateSalesMan(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.salesMan,
      valueSet,
      isRequired,
      'SalesManDimensions',
      'SalesMan',
    );
  }

  private validateTruckerType(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.truckerType,
      valueSet,
      isRequired,
      'TruckerTypeDimensions',
      'TruckerType',
    );
  }

  private validateTruckNumber(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.truckNumber,
      valueSet,
      isRequired,
      'TruckNumberDimensions',
      'TruckNumber',
    );
  }

  private validateDirection(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.direction,
      valueSet,
      isRequired,
      'DirectionDimensions',
      'Direction',
    );
  }

  private validateCoordinatorMan(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.coordinatorMan,
      valueSet,
      isRequired,
      'CoordinatorManDimensions',
      'CoordinatorMan',
    );
  }

  private validateVendor(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.vendor,
      valueSet,
      isRequired,
      'VendorDimensions',
      'Vendor',
    );
  }

  private validateSubVendor(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.subVendor,
      valueSet,
      isRequired,
      'SubVendorDimensions',
      'SubVendor',
    );
  }

  private validateWorker(
    ar: DynDataModel,
    valueSet: Set<string>,
    isRequired: boolean,
  ): void {
    this.validateDimensionField(
      ar,
      ar.DimensionModel?.worker,
      valueSet,
      isRequired,
      'WorkerDimensions',
      'Worker',
    );
  }
}
