import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PaymentTermDocument = HydratedDocument<PaymentTerm>;

@Schema({
  collection: 'payment-terms',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class PaymentTerm {
  @Prop({ required: true })
  company: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop()
  numberOfMonths?: number;

  @Prop()
  cutoffDayOfMonth?: number;

  @Prop()
  creditCardCreditCheckType?: string;

  @Prop()
  paymentScheduleName?: string;

  @Prop()
  isDefaultPaymentTerm?: string;

  @Prop()
  creditCardPaymentType?: string;

  @Prop()
  isCashPayment?: string;

  @Prop()
  numberOfDays?: number;

  @Prop()
  customerDueDateUpdatePolicy?: string;

  @Prop()
  paymentDayName?: string;

  @Prop()
  vendorDueDateUpdatePolicy?: string;

  @Prop()
  postOffsettingAR?: string;

  @Prop()
  paymentMethodType?: string;

  @Prop()
  cashPaymentMainAccountIdDisplayValue?: string;

  @Prop()
  isCertifiedCompanyCheck?: string;

  @Prop()
  additionalMonthsForCutoffDate?: number;
}

export const PaymentTermSchema = SchemaFactory.createForClass(PaymentTerm);

PaymentTermSchema.index({ company: 1, name: 1 }, { unique: true });
