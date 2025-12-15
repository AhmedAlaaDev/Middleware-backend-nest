import { RefreshToken } from '@/modules/auth/schemas/refresh-token.schema';
import { UserRole } from '@/modules/user/schemas/user.schema';

export interface IUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  avatarPath?: string;
  refreshTokens: RefreshToken[];
  createdAt: Date;
  updatedAt: Date;
}
