import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { IConfig } from '@/config';

export const API_KEY_HEADER = 'x-api-key';
export const REQUIRE_API_KEY = 'requireApiKey';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cfg: ConfigService<IConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requireApiKey = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_API_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requireApiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers[API_KEY_HEADER];
    const validApiKey = this.cfg.get('app')?.adminApiKey;

    if (!validApiKey) {
      throw new UnauthorizedException(
        'API Key authentication not configured on server',
      );
    }

    if (!apiKey) {
      throw new UnauthorizedException(
        'API Key required. Provide it in X-API-Key header',
      );
    }

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API Key');
    }

    return true;
  }
}
