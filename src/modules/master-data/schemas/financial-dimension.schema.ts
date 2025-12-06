import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FinancialDimensionDocument = HydratedDocument<FinancialDimension>;

@Schema({
  collection: 'financial_dimensions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class FinancialDimension {
  @Prop({ unique: true })
  financialKey: string;
}
export const FinancialDimensionSchema =
  SchemaFactory.createForClass(FinancialDimension);
