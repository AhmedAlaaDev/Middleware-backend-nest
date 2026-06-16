/**
 * Represents a Billing Classification from D365FO's BillingClassifications entity.
 */
export interface D365FOBillingClassification {
  '@odata.etag'?: string;
  dataAreaId: string;
  BillingClassification: string;
  CreditNoteNumber?: string;
  UseInterestCodeFromPostingProfile?: 'Yes' | 'No';
  InvoiceNumber?: string;
  InterestCode?: string;
  Description?: string;
  CollectionLetterSequence?: string;
  RestrictSettlementOfCreditNotes?: 'Yes' | 'No';
  UseCollectionLetterSequenceFromPostingProfile?: 'Yes' | 'No';
  TermsOfPayment?: string;
  RecId?: number; // Internal record ID
}

/**
 * Represents a Billing Code from D365FO's BillingClassificationCodes entity.
 */
export interface D365FOBillingCode {
  '@odata.etag'?: string;
  dataAreaId: string;
  BillingCode: string;
  BillingClassification: string;
  RecId?: number; // Internal record ID
}

/**
 * Represents a Billing Code Version from D365FO's BillingCodeVersions entity.
 */
export interface D365FOBillingCodeVersion {
  '@odata.etag'?: string;
  dataAreaId: string;
  BillingCode: string;
  BillingCodeDescription: string;
  ValidFrom: string;
  ValidTo: string;
  ItemSalesTaxGroup?: string;
  RateType?: string;
  RecId?: number;
}
