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
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

import { PaginatedResDto } from '@/common/dtos/paginated-res.dto';
import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { PostBatchInDFOCommand } from '@/modules/data-batch/commands/post-batch-in-dfo.command';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';
import {
  DataBatch,
  EntryProcessorTypes,
} from '@/modules/db/schemas/data-batch.schema';

@Controller('DataMigration/DataBatch')
@ApiTags('Data Migration - Data Batches')
@UseInterceptors(ClassSerializerInterceptor)
export class DataBatchController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'Get a list of data batches' })
  @ApiQuery({ name: 'EntryProcessorTypes', required: false, isArray: true })
  @ApiQuery({ name: 'batchNumberIds', required: false, isArray: true })
  @ApiQuery({ name: 'SkipCount', required: false, type: Number })
  @ApiQuery({ name: 'MaxCount', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Batch list retrieved successfully',
  })
  public async getDataBatchList(
    @Query('EntryProcessorTypes') entryProcessorTypes?: EntryProcessorTypes[],
    @Query('batchNumberIds') batchNumberIds?: string[],
    @Query('SkipCount') skipCount: number = 0,
    @Query('MaxCount') maxCount: number = 150,
  ): Promise<PaginatedResDto<DataBatch>> {
    return this.queryBus.execute(
      new GetDataBatchListQuery(
        entryProcessorTypes,
        batchNumberIds,
        skipCount,
        maxCount,
      ),
    );
  }

  @Post('insert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post batch to Dynamics 365 FO' })
  @ApiResponse({ status: 200, description: 'Batch queued for processing' })
  public async insertIntoDynamicsAsync(@Body() batchId: string): Promise<void> {
    return this.commandBus.execute(new PostBatchInDFOCommand(batchId));
  }

  @Post('download-enhanced-record-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download enhanced records as Excel file' })
  @ApiResponse({
    status: 200,
    description: 'Excel file downloaded',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  public async downloadEnhancedRecordListAsync(
    @Body() batchId: string,
  ): Promise<string> {
    return this.commandBus.execute(
      new DownloadBatchEnhancedRecordCommand(batchId),
    );
  }

  @Post('download-batch-error-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download batch errors as Excel file' })
  @ApiResponse({
    status: 200,
    description: 'Excel file downloaded',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  public async downloadErrorRecordListAsync(
    @Body() batchId: string,
  ): Promise<string> {
    return this.commandBus.execute(new DownloadBatchErrorCommand(batchId));
  }

  @Get('error-list')
  @ApiOperation({ summary: 'Get list of errors for a batch' })
  @ApiResponse({
    status: 200,
    description: 'Error list retrieved successfully',
  })
  public async getBatchErrorListAsync(
    @Query() batchId: string,
  ): Promise<PaginatedResDto<DataBatchError>> {
    return this.queryBus.execute(new GetBatchErrorListQuery(batchId));
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a batch with all related entities' })
  @ApiResponse({ status: 204, description: 'Batch deleted successfully' })
  async deleteAsync(@Query('id') id: string): Promise<void> {
    await this.commandBus.execute(new DeleteBatchCommand(id));
  }
}
