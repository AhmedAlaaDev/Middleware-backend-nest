import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DataBatchErrorDocument = HydratedDocument<DataBatchError>;

@Schema({
  collection: 'data_batch_errors',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataBatchError {
  @Prop()
  batchId: string;

  @Prop({ type: [String], default: [] })
  sourceRecordIds: string[];

  @Prop({ type: [String], required: true })
  errorMessages: string[];

  @Prop({ type: Object })
  accountDimensionsModel?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  enhancedRecordIds: string[];

  @Prop({ type: Object })
  enhancedData?: Record<string, unknown>;
}
export const DataBatchErrorSchema =
  SchemaFactory.createForClass(DataBatchError);
DataBatchErrorSchema.index({ batchId: 1 });
