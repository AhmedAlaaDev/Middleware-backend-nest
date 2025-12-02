import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { PostBatchInDFOCommand } from '@/modules/data-batch/commands/post-batch-in-dfo.command';
import { BatchIdDto } from '@/modules/data-batch/dtos/batch-id.dto';
import { DataBatchListDto } from '@/modules/data-batch/dtos/data-batch-list.dto';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';
import { DataBatch } from '@/modules/db/schemas/data-batch.schema';

/**
 * Data Migration - Data Batches
 */
@Controller('DataMigration/DataBatch')
@UseInterceptors(ClassSerializerInterceptor)
export class DataBatchController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Get a list of data batches
   */
  @Get('list')
  public async getDataBatchList(
    @Query() query: DataBatchListDto,
  ): Promise<IPaginatedRes<DataBatch>> {
    return this.queryBus.execute(
      new GetDataBatchListQuery(
        query.entryProcessorTypes,
        query.batchNumberIds,
        query.skipCount,
        query.maxCount,
      ),
    );
  }

  /**
   * Post batch to Dynamics 365 FO
   */
  @Post('insert')
  @HttpCode(HttpStatus.OK)
  public async insertIntoDynamicsAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<void> {
    return this.commandBus.execute(new PostBatchInDFOCommand(batchId));
  }

  /**
   * Download enhanced record list
   */
  @Post('download-enhanced-record-list')
  @HttpCode(HttpStatus.OK)
  public async downloadEnhancedRecordListAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<string> {
    return this.commandBus.execute(
      new DownloadBatchEnhancedRecordCommand(batchId),
    );
  }

  /**
   * Download batch error list
   */
  @Post('download-batch-error-list')
  @HttpCode(HttpStatus.OK)
  public async downloadErrorRecordListAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<string> {
    return this.commandBus.execute(new DownloadBatchErrorCommand(batchId));
  }

  /**
   * Get list of errors for a batch
   */
  @Get('error-list')
  public async getBatchErrorListAsync(
    @Query() { batchId }: BatchIdDto,
  ): Promise<IPaginatedRes<DataBatchError>> {
    return this.queryBus.execute(new GetBatchErrorListQuery(batchId));
  }

  /**
   * Delete a batch with all related entities
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteAsync(@Query() { batchId }: BatchIdDto): Promise<void> {
    await this.commandBus.execute(new DeleteBatchCommand(batchId));
  }
}
