import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VendorDocument = HydratedDocument<Vendor>;

@Schema({
  collection: 'vendors',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Vendor {
  @Prop({ required: true })
  company: string;

  @Prop({ required: true })
  vendorAccountNumber: string;

  @Prop()
  vendorOrganizationName?: string;

  @Prop()
  vendorSearchName?: string;

  @Prop()
  vendorGroupId?: string;

  @Prop()
  currencyCode?: string;

  @Prop()
  defaultPaymentTermsName?: string;

  @Prop()
  salesTaxGroupCode?: string;

  @Prop()
  onHoldStatus?: string;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);

VendorSchema.index(
  { company: 1, vendorAccountNumber: 1 },
  { unique: true },
);

