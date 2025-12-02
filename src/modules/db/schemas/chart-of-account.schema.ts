import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChartOfAccountDocument = HydratedDocument<ChartOfAccount>;

@Schema({
  collection: 'chart_of_accounts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class ChartOfAccount {
  @Prop({ unique: true })
  chartNumber: string;
}
export const ChartOfAccountSchema =
  SchemaFactory.createForClass(ChartOfAccount);
