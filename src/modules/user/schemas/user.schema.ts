import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, model } from 'mongoose';

import { RefreshToken } from '@/modules/auth/schemas/refresh-token.schema';

export enum UserRole {
  ADMIN = 'ADMIN',
  OPS = 'OPS',
}

export enum IdentityProvider {
  LOCAL = 'LOCAL',
  ENTRA = 'ENTRA',
}

export enum AccessStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
}

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class User {
  @Prop({ default: () => new Types.ObjectId() })
  _id: string;

  @Prop({ default: '' })
  firstName: string;

  @Prop({ default: '' })
  lastName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  passwordHash?: string;

  @Prop({ default: '' })
  avatarPath: string;

  @Prop({
    type: String,
    enum: UserRole,
  })
  role?: UserRole;

  @Prop({ type: String, enum: IdentityProvider, required: true })
  identityProvider: IdentityProvider;

  @Prop({ type: String, enum: AccessStatus })
  accessStatus?: AccessStatus;

  @Prop()
  entraTenantId?: string;

  @Prop()
  entraObjectId?: string;

  @Prop({ default: false })
  mustChangePassword: boolean;

  @Prop({ default: 1 })
  sessionVersion: number;

  @Prop()
  firstSignInAt?: Date;

  @Prop()
  lastSignInAt?: Date;

  @Prop()
  lastIp?: string;

  @Prop()
  lastUserAgent?: string;

  // relation (one-to-many)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'RefreshToken' }] })
  refreshTokens: RefreshToken[];
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index(
  { entraTenantId: 1, entraObjectId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      identityProvider: IdentityProvider.ENTRA,
    },
  },
);
UserSchema.index(
  { role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: UserRole.ADMIN },
  },
);

// Optional: Prisma-like cascade delete
UserSchema.pre(
  'findOneAndDelete',
  { document: false, query: true },
  async function (next: (err?: Error) => void) {
    const userId = this.getQuery()['_id'];

    await model('RefreshToken').deleteMany({ userId });

    next();
  },
);
