import {
  AccessStatus,
  IdentityProvider,
  UserRole,
} from '@/modules/user/schemas/user.schema';

export interface UserPayload {
  sub: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role?: UserRole;
  avatarPath?: string;
  identityProvider: IdentityProvider;
  accessStatus?: AccessStatus;
  mustChangePassword: boolean;
  sessionVersion: number;
}
