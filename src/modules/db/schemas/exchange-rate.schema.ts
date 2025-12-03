import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

@Schema({
  collection: 'exchange_rates',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class ExchangeRate {
  @Prop({ required: true })
  rateTypeName: string;

  @Prop({ required: true })
  fromCurrency: string;

  @Prop({ required: true })
  toCurrency: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  endDate: Date;

  @Prop()
  conversionFactor?: string;

  @Prop()
  rateTypeDescription?: string;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);

ExchangeRateSchema.index(
  { rateTypeName: 1, fromCurrency: 1, toCurrency: 1, startDate: 1 },
  { unique: true },
);

