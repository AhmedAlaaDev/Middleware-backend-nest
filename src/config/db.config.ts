import { registerAs } from '@nestjs/config';

export interface DBConfig {
  postgresqlUrl: string;
  mongodbUri: string;
  mongodbMaxPoolSize: number;
}

export const dbConfig = registerAs(
  'db',
  (): DBConfig => ({
    postgresqlUrl: process.env.POSTGRES_URL ?? '',
    mongodbUri: process.env.MONGODB_URI ?? '',
    mongodbMaxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE ?? '5', 10),
  }),
);
