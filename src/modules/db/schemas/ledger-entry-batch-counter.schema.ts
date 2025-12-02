import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LedgerEntryBatchCounterDocument =
  HydratedDocument<LedgerEntryBatchCounter>;

@Schema({
  collection: 'ledger_entry_batch_counters',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class LedgerEntryBatchCounter {
  @Prop({ unique: true })
  companyId: string;

  @Prop({ type: Number, default: 0 })
  lastBatchNumber: number;

  @Prop()
  companyBatchPrefix: string;
}
export const LedgerEntryBatchCounterSchema = SchemaFactory.createForClass(
  LedgerEntryBatchCounter,
);
