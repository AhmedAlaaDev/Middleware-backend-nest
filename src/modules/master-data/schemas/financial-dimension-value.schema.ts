import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FinancialDimensionValueDocument =
  HydratedDocument<FinancialDimensionValue>;

@Schema({
  collection: 'financial_dimension_values',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class FinancialDimensionValue {
  @Prop()
  financialDimensionKey: string;

  @Prop()
  value: string;

  @Prop()
  description?: string;
}
export const FinancialDimensionValueSchema = SchemaFactory.createForClass(
  FinancialDimensionValue,
);
FinancialDimensionValueSchema.index({ financialDimensionKey: 1 });
FinancialDimensionValueSchema.index(
  { financialDimensionKey: 1, value: 1 },
  { unique: true },
);
