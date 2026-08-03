import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
} from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import {
  ProcessCashInFreightCommand,
  ProcessCashInTruckingCommand,
  ProcessCashOutFreightCommand,
  ProcessCashOutTruckingCommand,
  PostCashBatchToDFOCommand,
} from '@/modules/cash/commands';
import {
  CashInFreightDocDto,
  CashInTruckingDocDto,
  CashOutFreightDocDto,
  CashOutTruckingDocDto,
  PostToDFODto,
} from '@/modules/cash/dtos';
import { ApplicationLogQueryService } from '@/modules/observability/services/application-log-query.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  QueuePauseState,
  QueueService,
} from '@/modules/queue/services/queue.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

/** Every cash batch, in or out, is posted through this queue. */
const CASH_POSTING_QUEUE = QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL;

/**
 * Data Migration - Cash (single controller for Cash-In and Cash-Out)
 */
@ApiBearerAuth()
@Controller('DataMigration/Cash')
export class CashController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly logs: ApplicationLogQueryService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Cash-Out Freight Document
   */
  @Post('CashOut-Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashOutFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashOutFreightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashOutFreightDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashOutFreightCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-In Freight Document
   */
  @Post('CashIn-Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInFreightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInFreightDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInFreightCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-Out Fleet (trucking) Document
   */
  @Post('CashOut-Trucking-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashOutTruckingDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashOutTruckingDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashOutTruckingDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashOutTruckingCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-In Fleet (trucking) Document
   */
  @Post('CashIn-Trucking-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInTruckingDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInTruckingDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInTruckingDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInTruckingCommand(file.buffer, companyId),
    );
  }

  /** Post a cash batch to its task-2045 AP, GL, or AR journal route. */
  @Post('PostToDFO')
  @ApiBody({
    description:
      'Post cash batch enhanced records to the D365FO journal selected by Safe Type and target processor',
    type: PostToDFODto,
  })
  public async postToDFO(@Body() body: PostToDFODto) {
    return this.commandBus.execute(new PostCashBatchToDFOCommand(body.batchId));
  }

  /**
   * State of the queue that carries cash batches to D365FO. Readable by anyone
   * who can post a batch, so the Cash pages can show that uploads are held.
   */
  @Get('posting-queue')
  @ApiOperation({ summary: 'Get the state of the cash posting queue' })
  public getPostingQueue(): Promise<QueuePauseState> {
    return this.queues.getPauseState(CASH_POSTING_QUEUE);
  }

  /**
   * Stop handing cash posting jobs to the worker. Batches submitted while the
   * queue is paused wait in it; a batch that is already being posted finishes
   * its current journal and is only stopped by pausing that batch.
   */
  @Post('posting-queue/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Pause the cash posting queue' })
  public pausePostingQueue(): Promise<QueuePauseState> {
    return this.queues.setPaused(CASH_POSTING_QUEUE, true);
  }

  @Post('posting-queue/resume')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Resume the cash posting queue' })
  public resumePostingQueue(): Promise<QueuePauseState> {
    return this.queues.setPaused(CASH_POSTING_QUEUE, false);
  }

  /**
   * Most recent JSON body sent to the DFO cash-out bulk endpoint, read back
   * from the observability log store.
   */
  @Post('debug/latest-dfo-payload')
  public async getLatestDfoPayload() {
    const log = await this.logs.getLatestByEventType(
      'd365fo.cash-out.bulk-request',
    );

    if (!log) {
      return {
        message: 'No payload captured yet. Please trigger an upload.',
      };
    }

    const payload = log.payload as
      | { request?: { body?: unknown; truncated?: boolean } }
      | undefined;

    return {
      eventId: log.eventId,
      timestamp: log.timestamp,
      journalNum: log.metadata?.journalNum,
      lineCount: log.metadata?.lineCount,
      lineNumbers: log.metadata?.lineNumbers,
      truncated: payload?.request?.truncated ?? false,
      body: payload?.request?.body ?? null,
    };
  }
}
