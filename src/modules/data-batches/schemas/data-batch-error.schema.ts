import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'DataBatchErrors', timestamps: true })
export class DataBatchError extends Document {
  @Prop({ required: true, index: true })
  batchId: string;

  @Prop({ type: [String], default: [] })
  sourceRecordIds: string[];

  @Prop({ type: [String], required: true })
  errorMessages: string[];

  @Prop({ type: Object })
  accountDimensionsModel?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  enhancedRecordIds: string[];
}

export const DataBatchErrorSchema =
  SchemaFactory.createForClass(DataBatchError);

// Indexes
DataBatchErrorSchema.index({ batchId: 1 });

