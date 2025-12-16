import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

import { AuthService } from '@/modules/auth/auth.service';
import { Auth } from '@/modules/auth/decorators/auth.decorator';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { CreateUserDto } from '@/modules/auth/dtos/create-user.dto';
import { LoginDto } from '@/modules/auth/dtos/login.dto';
import { AuthResponse } from '@/modules/auth/interfaces/auth-res.interface';
import { RefreshErrorCode } from '@/modules/auth/interfaces/session.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login an existing user
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body() loginDto: LoginDto,
    @Req() req: Req,
  ): Promise<AuthResponse> {
    const data = await this.authService.login(loginDto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });

    if (!data) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpiresAt: data.atExpiresAt,
      refreshTokenExpiresAt: data.rtExpiresAt,
    };
  }

  /**
   * Create a new user
   */
  @Public()
  @Post('register')
  public async register(
    @Body() createUserDto: CreateUserDto,
  ): Promise<AuthResponse> {
    const data = await this.authService.register(createUserDto);

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpiresAt: data.atExpiresAt,
      refreshTokenExpiresAt: data.rtExpiresAt,
    };
  }

  /**
   * Refresh token using the refresh token from X-Refresh-Token header
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'X-Refresh-Token',
    description: 'Refresh token for obtaining new access token',
    required: true,
    schema: {
      type: 'string',
    },
  })
  public async refresh(
    @Headers('X-Refresh-Token') refreshToken: string,
    @Req() req: Req,
  ): Promise<AuthResponse> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const result = await this.authService.refresh(refreshToken, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });

    if (!result.ok) {
      const map: Record<RefreshErrorCode, string> = {
        INVALID_TYPE: 'Invalid token',
        NOT_FOUND_REUSE_DETECTED: 'Refresh token reuse detected',
        EXPIRED_OR_REVOKED: 'Refresh token expired or revoked',
        HASH_MISMATCH: 'Refresh token mismatch',
        USER_NOT_FOUND: 'User not found',
      };
      throw new UnauthorizedException(map[result.code]);
    }

    return {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      accessTokenExpiresAt: result.data.atExpiresAt,
      refreshTokenExpiresAt: result.data.rtExpiresAt,
    };
  }

  /**
   * Logout current session
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader({
    name: 'X-Refresh-Token',
    description: 'Refresh token to revoke',
    required: true,
    schema: {
      type: 'string',
    },
  })
  public async logout(
    @Headers('X-Refresh-Token') refreshToken: string,
  ): Promise<void> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    await this.authService.logout(refreshToken);
  }

  /**
   * Logout all sessions for the authenticated user
   */
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logoutAll(@Auth('id') userId: string): Promise<void> {
    await this.authService.logoutAll(userId);
  }
}
