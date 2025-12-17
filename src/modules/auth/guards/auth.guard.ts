import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '@/modules/auth/decorators/public.decorator';
import { UserPayload } from '@/modules/auth/interfaces/user-payload.interface';
import { TokenService } from '@/modules/auth/services/token.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserService } from '@/modules/user/user.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.checkIsPublic(context);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Req>();

    const token = this.extractTokenFromHeaderOrThrow(request);

    const payload = await this.extractPayloadFromTokenOrThrow(token);

    const user = await this.getUserByIdOrThrow(payload.sub);

    request.user = user;

    return true;
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
    try {
      const user = await this.userService.findUserById(userId);
      if (!user) throw new UnauthorizedException('User not found.');

      const { passwordHash, ...userData } = user;

      return userData;
    } catch {
      throw new UnauthorizedException('User not found.');
    }
  }
}
