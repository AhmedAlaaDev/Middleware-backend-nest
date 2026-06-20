import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, model } from 'mongoose';

import { RefreshToken } from '@/modules/auth/schemas/refresh-token.schema';

export enum UserRole {
  ADMIN = 'ADMIN',
  OPS = 'OPS',
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

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: '' })
  avatarPath: string;

  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.OPS,
  })
  role: UserRole;

  // relation (one-to-many)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'RefreshToken' }] })
  refreshTokens: RefreshToken[];
}

export const UserSchema = SchemaFactory.createForClass(User);

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
