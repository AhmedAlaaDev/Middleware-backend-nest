export type DimensionKey =
  | 'MainAccount'
  | 'Activity'
  | 'CostCenters'
  | 'BusinessUnit'
  | 'Location'
  | 'Customer'
  | 'SubCustomer'
  | 'Vendor'
  | 'SubVendor'
  | 'ChargeType'
  | 'SalesMan'
  | 'CoordinatorMan'
  | 'FreightType'
  | 'Direction'
  | 'TruckerType'
  | 'TruckNumber'
  | 'Worker';

/**
 * Map of dimension keys to whether they are required.
 * - true = validate and require
 * - false = validate when present, but not required
 * Dimensions not in the object are not validated.
 */
export type RequiredDimensionsConfig = Partial<Record<DimensionKey, boolean>>;
