import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BillingClassificationDocument =
  HydratedDocument<BillingClassification>;

@Schema({
  collection: 'billing_classifications',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class BillingClassification {
  @Prop({ required: true })
  dataAreaId: string;

  @Prop({ required: true })
  billingClassification: string;

  @Prop()
  creditNoteNumber?: string;

  @Prop()
  useInterestCodeFromPostingProfile?: 'Yes' | 'No';

  @Prop()
  invoiceNumber?: string;

  @Prop()
  interestCode?: string;

  @Prop()
  description?: string;

  @Prop()
  collectionLetterSequence?: string;

  @Prop()
  restrictSettlementOfCreditNotes?: 'Yes' | 'No';

  @Prop()
  useCollectionLetterSequenceFromPostingProfile?: 'Yes' | 'No';

  @Prop()
  termsOfPayment?: string;
}

export const BillingClassificationSchema = SchemaFactory.createForClass(
  BillingClassification,
);

BillingClassificationSchema.index(
  { dataAreaId: 1, billingClassification: 1 },
  { unique: true },
);
