import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthConfig, IConfig } from '@/config';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService<IConfig>,
  ) {}

  public signAccess(payload: object): string {
    const secret = this.cfg.get<AuthConfig>('auth')?.accessSecret;
    const expiresIn = this.cfg.get<AuthConfig>('auth')?.accessTtl;

    return this.jwt.sign(payload, {
      secret,
      expiresIn,
    });
  }

  public signRefresh(payload: object): string {
    const secret = this.cfg.get<AuthConfig>('auth')?.refreshSecret;
    const expiresIn = this.cfg.get<AuthConfig>('auth')?.refreshTtl;

    return this.jwt.sign(payload, {
      secret,
      expiresIn,
    });
  }

  public verifyAccess<T extends object = any>(token: string): Promise<T> {
    const secret = this.cfg.get<AuthConfig>('auth')?.accessSecret;
    return this.jwt.verifyAsync<T>(token, {
      secret,
    });
  }

  public verifyRefresh<T extends object = any>(token: string): Promise<T> {
    const secret = this.cfg.get<AuthConfig>('auth')?.refreshSecret;
    return this.jwt.verifyAsync<T>(token, {
      secret,
    });
  }

  public decode<T = any>(token: string): T {
    return this.jwt.decode<T>(token);
  }

  public getReqHeaderToken(request: Req): string | null {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    const isBearerToken = type === 'Bearer';

    if (!token || !isBearerToken) return null;

    return token;
  }

  public formatExpDate(exp: number): string {
    return new Date(exp * 1000).toISOString();
  }
}
