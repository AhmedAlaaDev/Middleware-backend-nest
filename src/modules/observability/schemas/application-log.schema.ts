import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApplicationLogDocument = HydratedDocument<ApplicationLog>;

@Schema({
  collection: 'application_logs',
  timestamps: false,
  versionKey: false,
})
export class ApplicationLog {
  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true, index: true })
  level: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true, index: true })
  context: string;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ index: true })
  correlationId?: string;

  @Prop({ index: true })
  requestId?: string;

  @Prop()
  userId?: string;

  @Prop({ index: true })
  batchId?: string;

  @Prop({ index: true })
  jobId?: string;

  @Prop({ index: true })
  queueName?: string;

  @Prop()
  status?: string;

  @Prop()
  durationMs?: number;

  @Prop({ type: Object })
  error?: Record<string, unknown>;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ApplicationLogSchema =
  SchemaFactory.createForClass(ApplicationLog);
ApplicationLogSchema.index({ timestamp: -1, _id: -1 });
