import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MainAccountDocument = HydratedDocument<MainAccount>;

@Schema({
  collection: 'main_accounts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class MainAccount {
  @Prop()
  chartNumber: string;

  @Prop()
  accountNumber: string;
}
export const MainAccountSchema = SchemaFactory.createForClass(MainAccount);
MainAccountSchema.index({ chartNumber: 1 });
MainAccountSchema.index({ chartNumber: 1, accountNumber: 1 }, { unique: true });
