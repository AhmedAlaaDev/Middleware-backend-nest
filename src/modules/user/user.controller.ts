import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
} from '@nestjs/common';

import { AuthService } from '@/modules/auth/auth.service';
import { Auth } from '@/modules/auth/decorators/auth.decorator';
import {
  ChangePasswordDto,
  UpdateProfileDto,
} from '@/modules/user/dtos/profile.dto';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserRole } from '@/modules/user/schemas/user.schema';
import { UserService } from '@/modules/user/user.service';

@Controller('users')
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  me(@Auth() user: Omit<IUser, 'passwordHash'>) {
    return user;
  }

  @Patch('me')
  update(
    @Auth() user: Omit<IUser, 'passwordHash'>,
    @Body() dto: UpdateProfileDto,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Workforce profiles are managed by Microsoft',
      );
    }
    return this.users.updateAdminProfile(user.id, dto);
  }

  @Post('me/change-password')
  changePassword(
    @Auth() user: Omit<IUser, 'passwordHash'>,
    @Body() dto: ChangePasswordDto,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Password change is administrator-only');
    }
    return this.auth.changeAdminPassword(user.id, dto);
  }
}
