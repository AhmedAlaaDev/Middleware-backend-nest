import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiV1Controller } from '../../../common/decorators/api-controller.decorator';
import { OperationResultDto } from '../../common/dto/operation-result.dto';
import { PaginatedResultDto } from '../../common/dto/paginated-result.dto';
import { GetDataBatchListQuery } from '../queries/get-data-batch-list.query';
import { GetBatchErrorListQuery } from '../queries/get-batch-error-list.query';
import { PostBatchInDFOCommand } from '../commands/post-batch-indfo.command';
import { DeleteBatchCommand } from '../commands/delete-batch.command';
import { DownloadBatchEnhancedRecordCommand } from '../commands/download-batch-enhanced-record.command';
import { DownloadBatchErrorCommand } from '../commands/download-batch-error.command';
import { EntryProcessorTypes } from '../schemas/data-batch.schema';

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
  @ApiResponse({ status: 200, description: 'Batch list retrieved successfully' })
  async getDataBatchList(
    @Query('EntryProcessorTypes') entryProcessorTypes?: EntryProcessorTypes[],
    @Query('batchNumberIds') batchNumberIds?: string[],
    @Query('SkipCount') skipCount: number = 0,
    @Query('MaxCount') maxCount: number = 150,
  ): Promise<OperationResultDto<PaginatedResultDto<any>>> {
    const query = new GetDataBatchListQuery();
    query.entryProcessorTypes = entryProcessorTypes;
    query.batchNumberIds = batchNumberIds;
    query.skipCount = skipCount;
    query.maxCount = maxCount;

    return this.queryBus.execute(query);
  }

  @Post('insert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post batch to Dynamics 365 FO' })
  @ApiResponse({ status: 200, description: 'Batch queued for processing' })
  async insertIntoDynamicsAsync(
    @Body() command: PostBatchInDFOCommand,
  ): Promise<OperationResultDto<any>> {
    return this.commandBus.execute(command);
  }

  @Post('download-enhanced-record-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download enhanced records as Excel file' })
  @ApiResponse({
    status: 200,
    description: 'Excel file downloaded',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  async downloadEnhancedRecordListAsync(
    @Body() command: DownloadBatchEnhancedRecordCommand,
  ): Promise<any> {
    return this.commandBus.execute(command);
  }

  @Post('download-batch-error-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download batch errors as Excel file' })
  @ApiResponse({
    status: 200,
    description: 'Excel file downloaded',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  async downloadErrorRecordListAsync(
    @Body() command: DownloadBatchErrorCommand,
  ): Promise<any> {
    return this.commandBus.execute(command);
  }

  @Get('error-list')
  @ApiOperation({ summary: 'Get list of errors for a batch' })
  @ApiResponse({ status: 200, description: 'Error list retrieved successfully' })
  async getBatchErrorListAsync(
    @Query() query: GetBatchErrorListQuery,
  ): Promise<OperationResultDto<PaginatedResultDto<any>>> {
    return this.queryBus.execute(query);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a batch with all related entities' })
  @ApiResponse({ status: 204, description: 'Batch deleted successfully' })
  async deleteAsync(@Query('id') id: string): Promise<void> {
    const command = new DeleteBatchCommand();
    command.batchId = id;
    await this.commandBus.execute(command);
  }
}

