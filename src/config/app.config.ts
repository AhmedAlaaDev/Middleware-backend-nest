import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  prefix: string;
  environment: 'development' | 'production' | 'test';
  allowedCorsOrigins: string[];
}

export const appConfig = registerAs(
  'app',
  (): AppConfig => ({
    port: parseInt(process.env.PORT ?? '3000', 10),
    prefix: process.env.PREFIX ?? '',
    environment:
      (process.env.NODE_ENV as AppConfig['environment']) ?? 'development',
    allowedCorsOrigins: process.env.ALLOWED_CORS_ORIGINS?.split(',') ?? [],
  }),
);
