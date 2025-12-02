import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LedgerVoucherCounterDocument =
  HydratedDocument<LedgerVoucherCounter>;

@Schema({
  collection: 'ledger_voucher_counters',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class LedgerVoucherCounter {
  @Prop()
  journalName: string;

  @Prop({ type: Number, default: 0 })
  lastNumber: number;

  @Prop()
  companyId: string;

  @Prop()
  relatedSettingLogicalName: string;
}
export const LedgerVoucherCounterSchema =
  SchemaFactory.createForClass(LedgerVoucherCounter);
LedgerVoucherCounterSchema.index({ companyId: 1 });
LedgerVoucherCounterSchema.index(
  { companyId: 1, journalName: 1 },
  { unique: true },
);
