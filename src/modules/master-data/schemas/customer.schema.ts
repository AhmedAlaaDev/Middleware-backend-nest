import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({
  collection: 'customers',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Customer {
  @Prop({ required: true })
  company: string;

  @Prop({ required: true })
  customerAccount: string;

  @Prop()
  name?: string;

  @Prop()
  organizationPhoneticName?: string;

  @Prop()
  nameAlias?: string;

  @Prop()
  customerGroupId?: string;

  @Prop()
  salesCurrencyCode?: string;

  @Prop()
  invoiceAccount?: string;

  @Prop()
  partyNumber?: string;

  @Prop()
  organizationNumber?: string;

  @Prop()
  defaultDimensionDisplayValue?: string;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.index({ company: 1, customerAccount: 1 }, { unique: true });
