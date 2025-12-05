import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingDocument = HydratedDocument<AppSetting>;

@Schema({
  collection: 'app_settings',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class AppSetting {
  @Prop({ required: true })
  displayName: string;

  @Prop({ required: true, unique: true })
  logicalName: string;

  @Prop()
  value?: string;

  @Prop()
  groupName?: string;

  @Prop({ default: false })
  hasAction: boolean;

  @Prop({ default: 0 })
  order: number;
}
export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);

// Add index for groupName for faster queries
AppSettingSchema.index({ groupName: 1 });
