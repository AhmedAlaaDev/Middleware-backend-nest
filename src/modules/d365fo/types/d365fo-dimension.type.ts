/**
 * D365FO Dimension Attribute (Dimension) type
 * Represents a financial dimension definition from D365FO
 */
export interface D365FODimension {
  '@odata.etag'?: string;
  DimensionName: string;
  ReportColumnName?: string;
  CopyValuesOnCreate?: string;
  GiveDerivedDimensionsPrecedence?: string;
  UseValuesFrom?: string;
  DimensionValueMask?: string;
  BalancingDimension_PSN?: number;
  IsBalancing_PSN?: string;
  RecId?: number;
  Name?: string; // Alternative field name
  DimensionAttributeName?: string; // Alternative field name
}

/**
 * D365FO Financial Dimension Value type
 * Represents a specific value for a financial dimension
 */
export interface D365FODimensionValue {
  '@odata.etag'?: string;
  FinancialDimension: string;
  LegalEntityId: string;
  DimensionValue: string;
  GroupDimension?: string;
  IsSuspended?: string;
  IsBlockedForManualEntry?: string;
  IsTotal?: string;
  Description?: string;
  ActiveFrom?: string;
  ActiveTo?: string;
  Owner?: string;
  IsBalancing_PSN?: string;
  RecId?: number;
  Value?: string; // Alternative field name
  Name?: string; // Alternative field name
}
