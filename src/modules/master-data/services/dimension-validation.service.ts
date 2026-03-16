import { Injectable } from '@nestjs/common';

import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
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

      const fetchKey =
        key === 'SubCustomer'
          ? 'Customer'
          : key === 'SubVendor'
            ? 'Vendor'
            : key;

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
   * Builds a context string with CostCenter when present on the row.
   * Included in dimension error messages so the user can identify the row (e.g. "CostCenter: CC1 | ").
   */
  private getDimensionContext(dim: EntryDimensionsModel | undefined): string {
    if (!dim?.costCenter) return '';
    const v = String(dim.costCenter).trim();
    if (v === '' || v.toLowerCase() === '000') return '';
    return `CostCenter: ${v} | `;
  }

  /**
   * Shared validation for dimension fields that follow the standard pattern:
   * - Required check (empty or '000')
   * - Value must exist in allowed dimensions (exact match, case-insensitive)
   * Messages always show the value exactly as received from the source file (rawValue).
   */
  private validateDimensionField(
    ar: DynDataModel,
    rawValue: string | undefined,
    valueSet: Set<string>,
    isRequired: boolean,
    errorKey: string,
    label: string,
  ): void {
    const ctx = this.getDimensionContext(ar.DimensionModel);
    const valueForLookup = (rawValue ?? '').trim().toLowerCase();
    const displayValue =
      rawValue !== undefined && rawValue !== null ? rawValue : '';

    if (isRequired && (!valueForLookup || valueForLookup === '000')) {
      const fromFile =
        displayValue !== '' ? `"${displayValue}"` : '(empty or 000)';
      ar.AddError(
        errorKey,
        `${ctx}Dimension "${label}" is required. Value from your file: ${fromFile}.`,
      );
      return;
    }

    if (valueForLookup && !valueSet.has(valueForLookup)) {
      ar.AddError(
        errorKey,
        `${ctx}Dimension "${label}" value from your file "${displayValue}" was not found in the system. Check the value in your source file or ensure it exists in D365 and sync master data.`,
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
   * Messages always show the value exactly as received from the source file (rawValue).
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
    const ctx = this.getDimensionContext(ar.DimensionModel);
    const valueForLookup = (rawValue ?? '').trim();
    const displayValue =
      rawValue !== undefined && rawValue !== null ? rawValue : '';

    if (
      isRequired &&
      (!valueForLookup || valueForLookup.toLowerCase() === '000')
    ) {
      const fromFile =
        displayValue !== '' ? `"${displayValue}"` : '(empty or 000)';
      ar.AddError(
        errorKey,
        `${ctx}Dimension "${label}" is required. Value from your file: ${fromFile}.`,
      );
      return;
    }

    if (
      valueForLookup &&
      !allowedValues.some((d) => normalizer(d) === normalizer(valueForLookup))
    ) {
      ar.AddError(
        errorKey,
        `${ctx}Dimension "${label}" value from your file "${displayValue}" was not found in the system. Check the value in your source file or ensure it exists in D365 and sync master data.`,
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
    const dim = ar.DimensionModel;
    const rawSubVendor = dim?.subVendor;
    const rawVendor = dim?.vendor;

    const hasSubVendor =
      (rawSubVendor ?? '').trim() !== '' &&
      (rawSubVendor ?? '').trim().toLowerCase() !== '000';
    const hasVendor =
      (rawVendor ?? '').trim() !== '' &&
      (rawVendor ?? '').trim().toLowerCase() !== '000';

    if (hasSubVendor && !hasVendor) {
      const ctx = this.getDimensionContext(dim);
      const displaySubVendor =
        rawSubVendor !== undefined && rawSubVendor !== null ? rawSubVendor : '';

      ar.AddError(
        'SubVendorDimensions',
        `${ctx}Dimension "Vendor" is required when "SubVendor" is provided. SubVendor value from your file: "${displaySubVendor}".`,
      );
      return;
    }

    this.validateDimensionField(
      ar,
      rawSubVendor,
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
