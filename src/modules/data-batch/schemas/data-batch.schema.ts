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

  @Prop({ default: 0 })
  withholdingRemovedCount: number;

  @Prop({ default: 0 })
  withholdingRemovedAmount: number;

  @Prop({
    type: Number,
    enum: DataBatchStatus,
    default: DataBatchStatus.PendingPosting,
  })
  status: DataBatchStatus;

  @Prop()
  billingCodeId?: string;

  @Prop()
  expectedGroupCount?: number;

  @Prop()
  activeValidationRunId?: string;

  /** SHA-256 of canonical source rows. Identical uploads reuse one batch. */
  @Prop()
  sourceFingerprint?: string;

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

  /**
   * Holds the batch back from being posted to D365FO. A worker that is already
   * posting the batch stops after the journal it is currently writing, so the
   * flag is honoured both before and during posting.
   */
  @Prop({ default: false })
  postingPaused: boolean;

  @Prop()
  postingPausedAt?: Date;

  @Prop()
  postingPausedByUserId?: string;

  @Prop()
  postingPausedByName?: string;

  @Prop()
  postingPausedByEmail?: string;

  @Prop()
  postingResumedAt?: Date;

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

  /** Column headers in the order they appeared in the uploaded Excel file. */
  @Prop({ type: [String], default: undefined })
  sourceColumnHeaders?: string[];

  @Prop()
  lastReprocessJobId?: string;

  @Prop()
  lastReprocessStatus?: string;

  @Prop()
  lastReprocessError?: string;
}
export const DataBatchSchema = SchemaFactory.createForClass(DataBatch);
DataBatchSchema.index({ company: 1, entryProcessorType: 1 });
DataBatchSchema.index(
  { company: 1, entryProcessorType: 1, sourceFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceFingerprint: { $type: 'string' } },
  },
);
DataBatchSchema.index({ status: 1, createdAt: -1 });
DataBatchSchema.index({ postingPaused: 1, status: 1 });
DataBatchSchema.index({ createdAt: -1 });
