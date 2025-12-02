import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CacheEntryDocument = HydratedDocument<CacheEntry>;

@Schema({
  collection: 'cache_entries',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class CacheEntry {
  @Prop({ type: String })
  key: string;

  @Prop({ type: String })
  value: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}
export const CacheEntrySchema = SchemaFactory.createForClass(CacheEntry);
CacheEntrySchema.index({ expiresAt: 1 });
