import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import type {
  BatchReprocessStatus,
  CustomerCreationStatus,
  MissingCustomerField,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

export type DataBatchMissingMasterDataDocument =
  HydratedDocument<DataBatchMissingMasterData>;

@Schema({
  collection: 'data_batch_missing_master_data',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataBatchMissingMasterData {
  @Prop({ required: true })
  batchId: string;

  @Prop({ required: true })
  company: string;

  @Prop({ type: Number, enum: EntryProcessorTypes, required: true })
  entryProcessorType: EntryProcessorTypes;

  @Prop({ type: String, required: true })
  type: MissingMasterDataType;

  @Prop({ type: String, required: true })
  missingField: MissingCustomerField;

  @Prop({ required: true })
  missingValue: string;

  @Prop({ type: String, required: true, default: 'missing' })
  creationStatus: CustomerCreationStatus;

  @Prop({ type: String, required: true, default: 'not_started' })
  reprocessStatus: BatchReprocessStatus;

  @Prop({ required: true, default: 0 })
  affectedCount: number;

  @Prop({ type: Object })
  formDefaults?: Record<string, unknown>;

  @Prop({ type: [String] })
  readonlyFormFields?: string[];

  @Prop({ type: Object })
  createdData?: Record<string, unknown>;

  @Prop()
  createErrorMessage?: string;

  @Prop()
  reprocessErrorMessage?: string;

  @Prop({ required: true, default: 0 })
  reprocessAttempts: number;
}

export const DataBatchMissingMasterDataSchema = SchemaFactory.createForClass(
  DataBatchMissingMasterData,
);

// Indexes
DataBatchMissingMasterDataSchema.index({ batchId: 1 });
DataBatchMissingMasterDataSchema.index({
  batchId: 1,
  creationStatus: 1,
  reprocessStatus: 1,
});
DataBatchMissingMasterDataSchema.index(
  { batchId: 1, type: 1, missingField: 1, missingValue: 1 },
  { unique: true },
);
