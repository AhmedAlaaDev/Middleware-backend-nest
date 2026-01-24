/**
 * Represents a PaymentTerm from D365FO's PaymentTerms entity.
 */
export interface D365FOPaymentTerm {
  '@odata.etag'?: string;
  dataAreaId: string;
  Name: string;
  Description?: string;
  NumberOfMonths?: number;
  CutoffDayOfMonth?: number;
  CreditCardCreditCheckType?: string;
  PaymentScheduleName?: string;
  IsDefaultPaymentTerm?: 'Yes' | 'No';
  CreditCardPaymentType?: string;
  IsCashPayment?: 'Yes' | 'No';
  NumberOfDays?: number;
  CustomerDueDateUpdatePolicy?: string;
  PaymentDayName?: string;
  VendorDueDateUpdatePolicy?: string;
  PostOffsettingAR?: 'Yes' | 'No';
  PaymentMethodType?: string;
  CashPaymentMainAccountIdDisplayValue?: string;
  IsCertifiedCompanyCheck?: 'Yes' | 'No';
  AdditionalMonthsForCutoffDate?: number;
}
