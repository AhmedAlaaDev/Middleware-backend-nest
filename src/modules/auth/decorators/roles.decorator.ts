import { SetMetadata } from '@nestjs/common';

import { UserRole } from '@/modules/user/schemas/user.schema';

export const REQUIRED_ROLES = 'requiredRoles';
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
