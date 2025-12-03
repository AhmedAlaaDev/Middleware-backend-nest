/**
 * OData response wrapper for collections
 * Used by all D365FO API responses
 */
export interface D365FOODataResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  value: T[];
}
