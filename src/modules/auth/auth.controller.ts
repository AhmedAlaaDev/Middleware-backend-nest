import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

import type { Response } from 'express';

import { EntraConfig, IConfig } from '@/config';
import { AuthService } from '@/modules/auth/auth.service';
import { AllowStaleSession } from '@/modules/auth/decorators/allow-stale-session.decorator';
import { Auth } from '@/modules/auth/decorators/auth.decorator';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { ExchangeCodeDto } from '@/modules/auth/dtos/exchange-code.dto';
import { LoginDto } from '@/modules/auth/dtos/login.dto';
import { AuthResponse } from '@/modules/auth/interfaces/auth-res.interface';
import { RefreshErrorCode } from '@/modules/auth/interfaces/session.interface';
import { EntraOidcService } from '@/modules/auth/services/entra-oidc.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserService } from '@/modules/user/user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly entra: EntraOidcService,
    private readonly config: ConfigService<IConfig>,
    private readonly users: UserService,
  ) {}

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

  @Public()
  @Get('microsoft')
  public async microsoft(
    @Query('returnPath') returnPath: string | undefined,
    @Res() response: Response,
  ) {
    const result = await this.entra.start(returnPath);
    response.cookie('oidc_transaction', result.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    return response.redirect(result.authorizationUrl);
  }

  @Public()
  @Get('microsoft/callback')
  public async microsoftCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Req,
    @Res() response: Response,
  ) {
    const cookieState = this.readCookie(req.headers.cookie, 'oidc_transaction');
    const result = await this.entra.callback({
      code,
      state,
      cookieState,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    response.clearCookie('oidc_transaction', { path: '/' });
    const callbackUrl = new URL(
      this.config.getOrThrow<EntraConfig>('entra').frontendAuthCallbackUrl,
    );
    callbackUrl.searchParams.set('code', result.exchangeCode);
    callbackUrl.searchParams.set('returnPath', result.returnPath);
    return response.redirect(callbackUrl.toString());
  }

  @Public()
  @Post('microsoft/exchange')
  @HttpCode(HttpStatus.OK)
  public async exchange(
    @Body() dto: ExchangeCodeDto,
    @Req() req: Req,
  ): Promise<AuthResponse> {
    const exchange = await this.entra.consumeExchange(dto.code);
    const user = await this.users.findUserById(exchange.userId);
    if (!user) throw new UnauthorizedException('User not found');
    const data = await this.authService.issueSession(user, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    return this.toResponse(data);
  }

  @AllowStaleSession()
  @Get('access-status')
  public accessStatus(@Auth() user: Omit<IUser, 'passwordHash'>) {
    return {
      accessStatus: user.accessStatus,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
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

  private toResponse(data: {
    accessToken: string;
    refreshToken: string;
    atExpiresAt: string;
    rtExpiresAt: string;
  }): AuthResponse {
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpiresAt: data.atExpiresAt,
      refreshTokenExpiresAt: data.rtExpiresAt,
    };
  }

  private readCookie(
    header: string | undefined,
    name: string,
  ): string | undefined {
    return header
      ?.split(';')
      .map((value) => value.trim().split('='))
      .find(([key]) => key === name)?.[1];
  }
}
