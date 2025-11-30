import { PrismaClient } from '@/generated/prisma/client';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    let databaseUrl = configService.get<string>('DATABASE_URL');

    // Build DATABASE_URL from individual config if not provided
    if (!databaseUrl) {
      const host =
        configService.get<string>('DATABASE_HOST') ||
        configService.get<string>('database.host') ||
        'localhost';
      const port =
        configService.get<number>('DATABASE_PORT') ||
        configService.get<number>('database.port') ||
        5432;
      const username =
        configService.get<string>('DATABASE_USERNAME') ||
        configService.get<string>('database.username') ||
        'postgres';
      const password =
        configService.get<string>('DATABASE_PASSWORD') ||
        configService.get<string>('database.password') ||
        '';
      const database =
        configService.get<string>('DATABASE_NAME') ||
        configService.get<string>('database.name') ||
        'mgd365fomiddleware';

      // Build connection string with URL encoding for special characters in password
      const encodedPassword = encodeURIComponent(password);
      databaseUrl = `postgresql://${username}:${encodedPassword}@${host}:${port}/${database}?schema=public`;
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });

    super({
      adapter,
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  /**
   * Helper method to execute raw SQL queries when needed
   */
  async executeRaw<T = unknown>(
    query: string,
    ...params: unknown[]
  ): Promise<T> {
    return this.$queryRawUnsafe(query, ...params) as Promise<T>;
  }
}
