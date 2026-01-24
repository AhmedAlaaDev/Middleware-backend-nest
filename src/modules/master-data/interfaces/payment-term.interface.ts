export class IPaymentTerm {
  id: string;
  company: string;
  name: string;
  description?: string;
  numberOfMonths?: number;
  cutoffDayOfMonth?: number;
  creditCardCreditCheckType?: string;
  paymentScheduleName?: string;
  isDefaultPaymentTerm?: string;
  creditCardPaymentType?: string;
  isCashPayment?: string;
  numberOfDays?: number;
  customerDueDateUpdatePolicy?: string;
  paymentDayName?: string;
  vendorDueDateUpdatePolicy?: string;
  postOffsettingAR?: string;
  paymentMethodType?: string;
  cashPaymentMainAccountIdDisplayValue?: string;
  isCertifiedCompanyCheck?: string;
  additionalMonthsForCutoffDate?: number;
}

export interface ICreatePaymentTerm {
  company: string;
  name: string;
  description?: string;
  numberOfMonths?: number;
  cutoffDayOfMonth?: number;
  creditCardCreditCheckType?: string;
  paymentScheduleName?: string;
  isDefaultPaymentTerm?: string;
  creditCardPaymentType?: string;
  isCashPayment?: string;
  numberOfDays?: number;
  customerDueDateUpdatePolicy?: string;
  paymentDayName?: string;
  vendorDueDateUpdatePolicy?: string;
  postOffsettingAR?: string;
  paymentMethodType?: string;
  cashPaymentMainAccountIdDisplayValue?: string;
  isCertifiedCompanyCheck?: string;
  additionalMonthsForCutoffDate?: number;
}

export type IUpdatePaymentTerm = Partial<ICreatePaymentTerm>;

export interface IPaymentTermListFilter {
  company?: string;
  name?: string;
}
