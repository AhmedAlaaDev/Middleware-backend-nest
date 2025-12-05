import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum DataBatchStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Completed = 'Completed',
  Canceled = 'Canceled',
}

export enum EntryProcessorTypes {
  AccountReceivableFreight = 1,
  AccountReceivableTrucking = 2,
  AccountReceivableFreightCreditNote = 3,
  AccountReceivableTruckingCreditNote = 4,
  LedgerFreightClosingEntry = 5,
  LedgerTruckingClosingEntry = 6,
  AccountPayableFreight = 7,
  AccountPayableTrucking = 8,
  CustodyFreight = 9,
  CustodyTrucking = 10,
  LedgerCashOut = 11,
  LedgerBankOut = 12,
  LedgerVisaOut = 13,
  LedgerCashIn = 14,
  LedgerBankIn = 15,
  LedgerVisaIn = 16,
}

export type DataBatchDocument = HydratedDocument<DataBatch>;

@Schema({
  collection: 'data_batches',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataBatch {
  @Prop()
  company: string;

  @Prop({ enum: EntryProcessorTypes })
  entryProcessorType: EntryProcessorTypes;

  @Prop()
  entryProcessorName: string;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  errorCount: number;

  @Prop({ default: 0 })
  totalFormattedCount: number;

  @Prop({ default: 0 })
  totalUploadedCount: number;

  @Prop({ enum: DataBatchStatus, default: DataBatchStatus.Pending })
  status: DataBatchStatus;

  @Prop()
  billingCodeId?: string;
}
export const DataBatchSchema = SchemaFactory.createForClass(DataBatch);
DataBatchSchema.index({ company: 1, entryProcessorType: 1 });
DataBatchSchema.index({ status: 1, createdAt: -1 });
DataBatchSchema.index({ createdAt: -1 });
