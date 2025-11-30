import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './controllers/health.controller';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/services/prisma.service';

@Module({
  imports: [TerminusModule, DatabaseModule],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class HealthModule {}

