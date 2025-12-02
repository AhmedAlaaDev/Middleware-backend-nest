import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DataSourceRecordDocument = HydratedDocument<DataSourceRecord>;

@Schema({
  collection: 'data_source_records',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataSourceRecord {
  @Prop()
  batchId: string;

  @Prop({ type: Object, required: true })
  data: Record<string, any>;
}
export const DataSourceRecordSchema =
  SchemaFactory.createForClass(DataSourceRecord);
DataSourceRecordSchema.index({ batchId: 1 });
