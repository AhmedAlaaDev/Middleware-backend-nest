import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';

export type SyncJobDocument = HydratedDocument<SyncJob>;

@Schema({
  collection: 'sync_jobs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class SyncJob {
  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    enum: SyncJobStatus,
    default: SyncJobStatus.PENDING,
  })
  status: SyncJobStatus;

  @Prop()
  errorMessage?: string;
}

export const SyncJobSchema = SchemaFactory.createForClass(SyncJob);

SyncJobSchema.index({ name: 1 });
SyncJobSchema.index({ status: 1 });
// TTL index: auto-delete documents after 1 hour (3600 seconds)
SyncJobSchema.index({ created_at: 1 }, { expireAfterSeconds: 3600 });
