import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TaxItemGroupHeadingDocument = HydratedDocument<TaxItemGroupHeading>;

@Schema({
  collection: 'tax_item_group_headings',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class TaxItemGroupHeading {
  @Prop({ required: true })
  dataAreaId: string;

  @Prop({ required: true })
  taxItemGroup: string;

  @Prop()
  name?: string;
}

export const TaxItemGroupHeadingSchema =
  SchemaFactory.createForClass(TaxItemGroupHeading);

TaxItemGroupHeadingSchema.index(
  { dataAreaId: 1, taxItemGroup: 1 },
  { unique: true },
);
TaxItemGroupHeadingSchema.index({ dataAreaId: 1 });
