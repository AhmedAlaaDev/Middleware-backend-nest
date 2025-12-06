import * as Joi from 'joi';

import { AppConfig } from '@/config/app.config';
import { AuthConfig } from '@/config/auth.config';
import { D365FOConfig } from '@/config/d365fo.config';
import { DBConfig } from '@/config/db.config';
import { RedisConfig } from '@/config/redis.config';
import { ResilienceConfig } from '@/config/resilience.config';

export interface IConfig {
  app: AppConfig;
  auth: AuthConfig;
  d365fo: D365FOConfig;
  db: DBConfig;
  redis: RedisConfig;
  resilience: ResilienceConfig;
}

export const ConfigSchema = Joi.object<IConfig>({
  app: Joi.object<AppConfig>({
    port: Joi.number().default(3000),
    prefix: Joi.string().default('api'),
    environment: Joi.string().default('development'),
    allowedCorsOrigins: Joi.array().default([]),
  }),

  auth: Joi.object<AuthConfig>({
    jwtSecret: Joi.string().required(),
    jwtExpiresIn: Joi.string().default('15d'),
    jwtAudience: Joi.string().default('mg-d365fo-middleware'),
    jwtIssuer: Joi.string().default('mg-d365fo-middleware'),
  }),

  d365fo: Joi.object<D365FOConfig>({
    tenantId: Joi.string().required(),
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required(),
    resource: Joi.string().required(),
    authority: Joi.string().required(),
  }),

  db: Joi.object<DBConfig>({
    mongodbUri: Joi.string().required(),
    mongodbMaxPoolSize: Joi.number().default(5),
  }),

  redis: Joi.object<RedisConfig>({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(6379),
    password: Joi.string().optional(),
    db: Joi.number().default(0),
    maxRetriesPerRequest: Joi.number().default(3),
    enableReadyCheck: Joi.boolean().default(true),
    lazyConnect: Joi.boolean().default(false),
  }),

  resilience: Joi.object<ResilienceConfig>({
    circuitBreaker: Joi.object({
      timeout: Joi.number().default(30000),
      resetTimeout: Joi.number().default(30000),
      failureThreshold: Joi.number().default(5),
      errorThresholdPercentage: Joi.number().default(50),
      enabled: Joi.boolean().default(true),
    }),
    cache: Joi.object({
      l1Ttl: Joi.number().default(5 * 60 * 1000),
      l2Ttl: Joi.number().default(30 * 60 * 1000),
      l3Ttl: Joi.number().default(2 * 60 * 60 * 1000),
    }),
  }),
});

export * from './app.config';
export * from './auth.config';
export * from './d365fo.config';
export * from './db.config';
export * from './redis.config';
export * from './resilience.config';
