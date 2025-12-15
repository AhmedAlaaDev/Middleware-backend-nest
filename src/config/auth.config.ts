import { registerAs } from '@nestjs/config';
import { JwtSignOptions } from '@nestjs/jwt';

export interface AuthConfig {
  accessSecret: JwtSignOptions['secret'];
  accessTtl: JwtSignOptions['expiresIn'];
  refreshSecret: JwtSignOptions['secret'];
  refreshTtl: JwtSignOptions['expiresIn'];
}

export const authConfig = registerAs(
  'auth',
  (): AuthConfig => ({
    accessSecret: process.env.JWT_ACCESS_SECRET as JwtSignOptions['secret'],
    accessTtl: process.env.JWT_ACCESS_TTL as JwtSignOptions['expiresIn'],
    refreshSecret: process.env.JWT_REFRESH_SECRET as JwtSignOptions['secret'],
    refreshTtl: process.env.JWT_REFRESH_TTL as JwtSignOptions['expiresIn'],
  }),
);
