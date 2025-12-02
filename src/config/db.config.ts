import { registerAs } from '@nestjs/config';

export interface DBConfig {
  mongodbUri: string;
  mongodbMaxPoolSize: number;
}

export const dbConfig = registerAs(
  'db',
  (): DBConfig => ({
    mongodbUri: process.env.MONGODB_URI ?? '',
    mongodbMaxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE ?? '5', 10),
  }),
);
