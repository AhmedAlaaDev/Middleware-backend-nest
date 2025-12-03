/**
 * Represents an Exchange Rate from D365FO's ExchangeRates entity.
 */
export interface D365FOExchangeRate {
  '@odata.etag'?: string;
  RateTypeName: string;
  FromCurrency: string;
  ToCurrency: string;
  StartDate: string; // ISO 8601 date string
  Rate: number;
  EndDate: string; // ISO 8601 date string
  ConversionFactor?: string;
  RateTypeDescription?: string;
  RecId?: number;
}

