import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QueueJobDocument = HydratedDocument<QueueJob>;

export enum DurableQueueJobStatus {
  QUEUED = 'queued',
  ACTIVE = 'active',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Schema({
  collection: 'queue_jobs',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
})
export class QueueJob {
  @Prop({ required: true, unique: true })
  jobId: string;

  @Prop({ required: true, index: true })
  queueName: string;

  @Prop({ required: true })
  jobName: string;

  @Prop({ required: true, index: true })
  batchId: string;

  @Prop({ required: true })
  company: string;

  @Prop({ required: true, index: true })
  correlationId: string;

  @Prop({ required: true })
  sourceModule: string;

  @Prop()
  journalKind?: string;

  @Prop()
  cashDirection?: string;

  @Prop({ required: true, default: 1 })
  payloadVersion: number;

  @Prop({
    required: true,
    enum: DurableQueueJobStatus,
    default: DurableQueueJobStatus.QUEUED,
    index: true,
  })
  status: DurableQueueJobStatus;

  @Prop({ required: true })
  totalGroups: number;

  @Prop({ default: 0 })
  completedGroups: number;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop()
  heartbeatAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  error?: string;
}

export const QueueJobSchema = SchemaFactory.createForClass(QueueJob);
QueueJobSchema.index({ batchId: 1, createdAt: -1 });
QueueJobSchema.index({ status: 1, heartbeatAt: 1 });
