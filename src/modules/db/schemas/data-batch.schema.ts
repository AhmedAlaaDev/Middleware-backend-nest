import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum DataBatchStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Completed = 'Completed',
  Canceled = 'Canceled',
}

export enum EntryProcessorTypes {
  AccountReceivableFreight = 'AccountReceivableFreight',
  AccountReceivableTrucking = 'AccountReceivableTrucking',
  AccountReceivableFreightCreditNote = 'AccountReceivableFreightCreditNote',
  AccountReceivableTruckingCreditNote = 'AccountReceivableTruckingCreditNote',
  LedgerFreightClosingEntry = 'LedgerFreightClosingEntry',
  LedgerTruckingClosingEntry = 'LedgerTruckingClosingEntry',
  AccountPayableFreight = 'AccountPayableFreight',
  AccountPayableTrucking = 'AccountPayableTrucking',
  CustodyFreight = 'CustodyFreight',
  CustodyTrucking = 'CustodyTrucking',
  LedgerCashOut = 'LedgerCashOut',
  LedgerBankOut = 'LedgerBankOut',
  LedgerVisaOut = 'LedgerVisaOut',
  LedgerCashIn = 'LedgerCashIn',
  LedgerBankIn = 'LedgerBankIn',
  LedgerVisaIn = 'LedgerVisaIn',
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
