import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BillingCodeVersionDocument = HydratedDocument<BillingCodeVersion>;

@Schema({
  collection: 'billing_code_versions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class BillingCodeVersion {
  @Prop({ required: true })
  dataAreaId: string;

  @Prop({ required: true })
  billingCode: string;

  @Prop({ required: true })
  billingCodeDescription: string;

  @Prop({ required: true })
  validFrom: Date;

  @Prop({ required: true })
  validTo: Date;

  @Prop()
  itemSalesTaxGroup?: string;

  @Prop()
  rateType?: string;
}

export const BillingCodeVersionSchema =
  SchemaFactory.createForClass(BillingCodeVersion);

BillingCodeVersionSchema.index({
  dataAreaId: 1,
  billingCode: 1,
  billingCodeDescription: 1,
  validFrom: 1,
  validTo: 1,
});
BillingCodeVersionSchema.index({
  dataAreaId: 1,
  billingCodeDescription: 1,
});
