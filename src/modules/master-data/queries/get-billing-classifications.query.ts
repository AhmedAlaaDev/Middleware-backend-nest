import { Query } from '@nestjs/cqrs';

export interface BillingClassification {
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

export class GetBillingClassificationsQuery extends Query<
  BillingClassification[]
> {
  constructor(public readonly company?: string) {
    super();
  }
}
