import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  
  PORT: Joi.number().default(3000),
  
  // Database - Either DATABASE_URL or individual fields
  DATABASE_URL: Joi.string().optional(),
  DATABASE_HOST: Joi.string().default('localhost'),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USERNAME: Joi.string().allow('').optional(),
  DATABASE_PASSWORD: Joi.string().allow('').optional(),
  DATABASE_NAME: Joi.string().allow('').optional(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  
  // MongoDB
  MONGODB_URI: Joi.string().required(),
  
  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  
  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('15d'),
  JWT_AUDIENCE: Joi.string().allow('').optional(),
  
  // D365FO
  D365FO_TENANT_ID: Joi.string().required(),
  D365FO_CLIENT_ID: Joi.string().required(),
  D365FO_CLIENT_SECRET: Joi.string().required(),
  D365FO_RESOURCE: Joi.string().required(),
  D365FO_AUTHORITY: Joi.string().optional(),
});

