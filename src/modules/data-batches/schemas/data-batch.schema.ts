import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum DataBatchStatus {
  Pending = 1,
  Processing = 2,
  Completed = 3,
  Canceled = 4,
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

@Schema({ collection: 'DataBatches', timestamps: true })
export class DataBatch extends Document {
  @Prop({ required: true, index: true })
  company: string;

  @Prop({ required: true, type: Number, enum: EntryProcessorTypes })
  entryProcessorType: EntryProcessorTypes;

  @Prop({ required: true })
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

  @Prop({
    type: Number,
    enum: DataBatchStatus,
    default: DataBatchStatus.Pending,
    index: true,
  })
  status: DataBatchStatus;

  @Prop()
  billingCodeId?: string;
}

export const DataBatchSchema = SchemaFactory.createForClass(DataBatch);

// Indexes for performance
DataBatchSchema.index({ company: 1, entryProcessorType: 1 });
DataBatchSchema.index({ status: 1, createdAt: -1 });
DataBatchSchema.index({ createdAt: -1 });

