import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BillingCodeDocument = HydratedDocument<BillingCode>;

@Schema({
  collection: 'billing_codes',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class BillingCode {
  @Prop({ required: true })
  dataAreaId: string;

  @Prop({ required: true })
  billingCode: string;

  @Prop({ required: true })
  billingClassification: string;
}

export const BillingCodeSchema = SchemaFactory.createForClass(BillingCode);

// Create compound index for unique billing code per company
BillingCodeSchema.index(
  { dataAreaId: 1, billingCode: 1 },
  { unique: true },
);

// Index for filtering by billing classification
BillingCodeSchema.index({ dataAreaId: 1, billingClassification: 1 });

