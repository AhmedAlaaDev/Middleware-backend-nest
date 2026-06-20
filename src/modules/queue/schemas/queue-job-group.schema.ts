import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QueueJobGroupDocument = HydratedDocument<QueueJobGroup>;

export enum QueueJobGroupStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

@Schema({
  collection: 'queue_job_groups',
  timestamps: true,
  versionKey: false,
})
export class QueueJobGroup {
  @Prop({ required: true, index: true })
  jobId: string;

  @Prop({ required: true })
  index: number;

  @Prop({ required: true, type: Object })
  payload: Record<string, unknown>;

  @Prop({
    required: true,
    enum: QueueJobGroupStatus,
    default: QueueJobGroupStatus.PENDING,
  })
  status: QueueJobGroupStatus;

  @Prop()
  createdHeaderId?: string;

  @Prop()
  completedAt?: Date;
}

export const QueueJobGroupSchema = SchemaFactory.createForClass(QueueJobGroup);
QueueJobGroupSchema.index({ jobId: 1, index: 1 }, { unique: true });
