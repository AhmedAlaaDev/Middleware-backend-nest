import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { AccessStatus } from '@/modules/user/schemas/user.schema';

export type AccessDecisionDocument = HydratedDocument<AccessDecision>;

export enum AccessDecisionAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REVOKE = 'REVOKE',
  RECONSIDER_PENDING = 'RECONSIDER_PENDING',
  RECONSIDER_APPROVE = 'RECONSIDER_APPROVE',
}

@Schema({
  collection: 'user_access_decisions',
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class AccessDecision {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorUserId: string;

  @Prop({ type: String, enum: AccessStatus, required: true })
  previousStatus: AccessStatus;

  @Prop({ type: String, enum: AccessStatus, required: true })
  newStatus: AccessStatus;

  @Prop({ type: String, enum: AccessDecisionAction, required: true })
  action: AccessDecisionAction;

  @Prop()
  reason?: string;

  @Prop()
  correlationId?: string;

  @Prop()
  actorIp?: string;

  @Prop()
  actorUserAgent?: string;

  createdAt: Date;
}

export const AccessDecisionSchema =
  SchemaFactory.createForClass(AccessDecision);
AccessDecisionSchema.index({ userId: 1, createdAt: -1 });
