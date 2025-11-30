import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'DataEnhancedRecords', timestamps: true })
export class DataEnhancedRecord extends Document {
  @Prop({ required: true, index: true })
  batchId: string;

  @Prop({ type: Object })
  dimensionModel?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  sourceIds: string[];

  @Prop({ type: Object, required: true })
  data: Record<string, any>;

  @Prop({ required: true, index: true })
  dataModelType: string;
}

export const DataEnhancedRecordSchema =
  SchemaFactory.createForClass(DataEnhancedRecord);

// Indexes for performance
DataEnhancedRecordSchema.index({ batchId: 1, dataModelType: 1 });

