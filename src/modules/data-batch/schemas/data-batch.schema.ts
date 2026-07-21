import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';

export type DataBatchDocument = HydratedDocument<DataBatch>;

@Schema({
  collection: 'data_batches',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataBatch {
  @Prop()
  company: string;

  @Prop({ type: Number, enum: EntryProcessorTypes })
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

  @Prop({ type: Number, enum: DataBatchStatus, default: DataBatchStatus.PendingPosting })
  status: DataBatchStatus;

  @Prop()
  billingCodeId?: string;

  @Prop()
  expectedGroupCount?: number;

  @Prop()
  activeValidationRunId?: string;

  @Prop({ type: [String], default: [] })
  dfoIds?: string[];

  @Prop({ type: [String], default: [] })
  dfoPostingErrors?: string[];

  @Prop()
  createdByUserId?: string;

  @Prop()
  createdByName?: string;

  @Prop()
  createdByEmail?: string;

  @Prop()
  lastReprocessedAt?: Date;

  @Prop()
  lastReprocessedByUserId?: string;

  @Prop()
  lastReprocessedByName?: string;

  @Prop()
  lastReprocessedByEmail?: string;

  @Prop({ default: 0 })
  reprocessCount: number;

  @Prop()
  lastReprocessJobId?: string;

  @Prop()
  lastReprocessStatus?: string;

  @Prop()
  lastReprocessError?: string;
}
export const DataBatchSchema = SchemaFactory.createForClass(DataBatch);
DataBatchSchema.index({ company: 1, entryProcessorType: 1 });
DataBatchSchema.index({ status: 1, createdAt: -1 });
DataBatchSchema.index({ createdAt: -1 });
