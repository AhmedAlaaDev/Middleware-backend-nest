import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_STALE_SESSION } from '@/modules/auth/decorators/allow-stale-session.decorator';
import { IS_PUBLIC_KEY } from '@/modules/auth/decorators/public.decorator';
import { UserPayload } from '@/modules/auth/interfaces/user-payload.interface';
import { TokenService } from '@/modules/auth/services/token.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import {
  AccessStatus,
  IdentityProvider,
  UserRole,
} from '@/modules/user/schemas/user.schema';
import { UserService } from '@/modules/user/user.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly traceContext: TraceContextService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.checkIsPublic(context);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Req>();

    const token = this.extractTokenFromHeaderOrThrow(request);

    const payload = await this.extractPayloadFromTokenOrThrow(token);

    const user = await this.getUserByIdOrThrow(payload.sub);

    const allowStale = this.reflector.getAllAndOverride<boolean>(
      ALLOW_STALE_SESSION,
      [context.getHandler(), context.getClass()],
    );
    if (!allowStale && payload.sessionVersion !== user.sessionVersion) {
      throw new UnauthorizedException('Session permissions changed.');
    }

    request.user = user;
    this.traceContext.setAuthenticatedUser(user);
    this.enforceAccessPolicy(request, user);

    return true;
  }

  private enforceAccessPolicy(
    request: Req,
    user: Omit<IUser, 'passwordHash'>,
  ): void {
    const route = request.path;
    const method = request.method.toUpperCase();
    const restrictedWorkforce =
      user.identityProvider === IdentityProvider.ENTRA &&
      user.accessStatus !== AccessStatus.APPROVED;
    const restrictedAdmin =
      user.role === UserRole.ADMIN && user.mustChangePassword;
    if (!restrictedWorkforce && !restrictedAdmin) return;

    const allowed = new Set([
      'GET:/users/me',
      'GET:/auth/access-status',
      'POST:/auth/logout-all',
      'POST:/users/me/change-password',
    ]);
    const normalizedPath = route.replace(/^\/api\/v\d+/, '');
    if (!allowed.has(`${method}:${normalizedPath}`)) {
      throw new ForbiddenException('Access is restricted');
    }
  }

  private checkIsPublic(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private extractTokenFromHeaderOrThrow(request: Req): string {
    const token = this.tokenService.getReqHeaderToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'No token provided. Please provide a token in the Authorization header using the Bearer scheme. e.g. "Bearer <token>"',
      );
    }

    return token;
  }

  private async extractPayloadFromTokenOrThrow(
    accessToken: string,
  ): Promise<UserPayload> {
    try {
      const payload = await this.tokenService.verifyAccess(accessToken);

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid token.');
    }
  }

  private async getUserByIdOrThrow(
    userId: string,
  ): Promise<Omit<IUser, 'passwordHash'>> {
    const user = await this.userService.findUserById(userId);
    if (!user) throw new UnauthorizedException('User not found.');

    const { passwordHash, ...userData } = user;
    return userData;
  }
}
