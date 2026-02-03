/**
 * Represents a TaxItemGroupHeading from D365FO's TaxItemGroupHeadings entity.
 * Item sales tax group (e.g. VAT-0%, VAT-14%, VAT-10%).
 */
export interface D365FOTaxItemGroupHeading {
  '@odata.etag'?: string;
  dataAreaId: string;
  TaxItemGroup: string;
  Name?: string;
}
