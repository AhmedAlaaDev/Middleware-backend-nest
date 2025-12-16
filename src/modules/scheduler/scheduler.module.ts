import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from '@/modules/auth/auth.module';
import { TokenCleanupJob } from '@/modules/scheduler/jobs/token-cleanup.job';
import { SchedulerController } from '@/modules/scheduler/scheduler.controller';
import { SchedulerService } from '@/modules/scheduler/scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule, // Import to access SessionService
  ],
  providers: [SchedulerService, TokenCleanupJob],
  exports: [SchedulerService],
  controllers: [SchedulerController],
})
export class SchedulerModule {}
