export interface VatNumTableRecord {
  '@odata.etag'?: string;
  dataAreaId: string;
  VATNum: string;
  CountryRegionId: string;
  Name: string;
}

export interface CreateVatNumTableInput {
  dataAreaId: string;
  VATNum: string;
  CountryRegionId: string;
  Name: string;
}
