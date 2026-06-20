import { RefreshToken } from '@/modules/auth/schemas/refresh-token.schema';
import {
  AccessStatus,
  IdentityProvider,
  UserRole,
} from '@/modules/user/schemas/user.schema';

export interface IUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role?: UserRole;
  passwordHash?: string;
  avatarPath?: string;
  identityProvider: IdentityProvider;
  accessStatus?: AccessStatus;
  entraTenantId?: string;
  entraObjectId?: string;
  mustChangePassword: boolean;
  sessionVersion: number;
  firstSignInAt?: Date;
  lastSignInAt?: Date;
  lastIp?: string;
  lastUserAgent?: string;
  refreshTokens: RefreshToken[];
  createdAt: Date;
  updatedAt: Date;
}
