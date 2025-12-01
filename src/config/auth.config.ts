import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtAudience: string;
  jwtIssuer: string;
}

export const authConfig = registerAs(
  'auth',
  (): AuthConfig => ({
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15d',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'mg-d365fo-middleware',
    jwtIssuer: process.env.JWT_ISSUER ?? 'mg-d365fo-middleware',
  }),
);
