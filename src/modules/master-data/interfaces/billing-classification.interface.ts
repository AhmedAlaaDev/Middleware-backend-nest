export class IBillingClassification {
  id: string;
  dataAreaId: string;
  billingClassification: string;
  creditNoteNumber?: string;
  useInterestCodeFromPostingProfile?: 'Yes' | 'No';
  invoiceNumber?: string;
  interestCode?: string;
  description?: string;
  collectionLetterSequence?: string;
  restrictSettlementOfCreditNotes?: 'Yes' | 'No';
  useCollectionLetterSequenceFromPostingProfile?: 'Yes' | 'No';
  termsOfPayment?: string;
}

export interface ICreateBillingClassification {
  dataAreaId: string;
  billingClassification: string;
  creditNoteNumber?: string;
  useInterestCodeFromPostingProfile?: 'Yes' | 'No';
  invoiceNumber?: string;
  interestCode?: string;
  description?: string;
  collectionLetterSequence?: string;
  restrictSettlementOfCreditNotes?: 'Yes' | 'No';
  useCollectionLetterSequenceFromPostingProfile?: 'Yes' | 'No';
  termsOfPayment?: string;
}

export type IUpdateBillingClassification =
  Partial<ICreateBillingClassification>;

export interface IBillingClassificationListFilter {
  company?: string;
}
