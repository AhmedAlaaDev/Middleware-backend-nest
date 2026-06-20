import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DataEnhancedRecordDocument = HydratedDocument<DataEnhancedRecord>;

@Schema({
  collection: 'data_enhanced_records',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class DataEnhancedRecord {
  @Prop()
  batchId: string;

  @Prop({ type: Object })
  dimensionModel?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  sourceIds: string[];

  @Prop({ type: Object, required: true })
  data: Record<string, any>;

  @Prop()
  dataModelType: string;

  @Prop({ required: true })
  validationRunId: string;
}
export const DataEnhancedRecordSchema =
  SchemaFactory.createForClass(DataEnhancedRecord);
DataEnhancedRecordSchema.index({
  batchId: 1,
  validationRunId: 1,
  dataModelType: 1,
});
