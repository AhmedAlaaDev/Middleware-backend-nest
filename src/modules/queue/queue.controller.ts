import { Controller, Get, Post, Body, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { QueueService } from './services/queue.service';
import { ExampleJobData } from './processors/example.processor';

@ApiTags('Queue')
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('example')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Add a job to the example queue' })
  @ApiResponse({ status: 202, description: 'Job added successfully' })
  async addExampleJob(@Body() data: ExampleJobData) {
    const job = await this.queueService.addExampleJob(data);
    return {
      jobId: job.id,
      status: 'accepted',
      message: 'Job added to queue',
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get queue statistics' })
  @ApiResponse({ status: 200, description: 'Queue statistics' })
  async getStats() {
    return this.queueService.getQueueStats();
  }

  @Get('job/:jobId')
  @ApiOperation({ summary: 'Get job by ID' })
  @ApiResponse({ status: 200, description: 'Job details' })
  async getJob(@Param('jobId') jobId: string) {
    const job = await this.queueService.getJob(jobId);
    if (!job) {
      return { error: 'Job not found' };
    }
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      state: await job.getState(),
      progress: job.progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  @Post('job/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiResponse({ status: 200, description: 'Job retried successfully' })
  async retryJob(@Param('jobId') jobId: string) {
    await this.queueService.retryJob(jobId);
    return { message: 'Job retried successfully' };
  }

  @Delete('job/:jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a job' })
  @ApiResponse({ status: 200, description: 'Job removed successfully' })
  async removeJob(@Param('jobId') jobId: string) {
    await this.queueService.removeJob(jobId);
    return { message: 'Job removed successfully' };
  }
}


