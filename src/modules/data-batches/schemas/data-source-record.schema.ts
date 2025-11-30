import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'DataSourceRecords', timestamps: true })
export class DataSourceRecord extends Document {
  @Prop({ required: true, index: true })
  batchId: string;

  @Prop({ type: Object, required: true })
  data: Record<string, any>;
}

export const DataSourceRecordSchema =
  SchemaFactory.createForClass(DataSourceRecord);

// Indexes
DataSourceRecordSchema.index({ batchId: 1 });

