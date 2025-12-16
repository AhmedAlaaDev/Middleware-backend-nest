import { createReadStream } from 'fs';

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
  Header,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiProduces,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { BatchIdDto } from '@/modules/data-batch/dtos/batch-id.dto';
import { DataBatchListDto } from '@/modules/data-batch/dtos/data-batch-list.dto';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { GetDataBatchByIdQuery } from '@/modules/data-batch/queries/get-data-batch-by-id.query';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';

/**
 * Data Migration - Data Batches
 */
@ApiBearerAuth()
@ApiTags('Data Migration - Data Batches')
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
  @ApiPaginatedResponse(IDataBatch)
  public async getDataBatchList(
    @Query() query: DataBatchListDto,
  ): Promise<IPaginatedRes<IDataBatch>> {
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
   * Get list of errors for a batch
   */
  @Get('error-list')
  @ApiOperation({ summary: 'Get list of errors for a batch' })
  @ApiPaginatedResponse(IDataBatchError)
  public async getBatchErrorListAsync(
    @Query() { batchId }: BatchIdDto,
  ): Promise<IPaginatedRes<IDataBatchError>> {
    return this.queryBus.execute(new GetBatchErrorListQuery(batchId));
  }

  /**
   * Get a data batch by ID
   */
  @Get(':batchId')
  @ApiOperation({
    summary: 'Get a data batch by ID',
    description:
      'Retrieves a single data batch with the specified ID. Returns 404 if not found.',
  })
  @ApiParam({
    name: 'batchId',
    description: 'The unique identifier of the data batch',
    type: String,
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Data batch retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: '507f1f77bcf86cd799439011' },
        company: { type: 'string', example: 'm-p' },
        entryProcessorType: {
          type: 'string',
          example: 'AccountReceivableFreight',
        },
        entryProcessorName: {
          type: 'string',
          example: 'AccountReceivableFreightEntryProcessor',
        },
        description: {
          type: 'string',
          example: 'Account Receivable Freight batch',
        },
        status: { type: 'string', example: 'Pending' },
        successCount: { type: 'number', example: 100 },
        errorCount: { type: 'number', example: 5 },
        totalFormattedCount: { type: 'number', example: 105 },
        totalUploadedCount: { type: 'number', example: 105 },
        billingCodeId: { type: 'string', example: 'billing-code-123' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Data batch not found',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 404 },
        message: {
          type: 'string',
          example: 'Data batch with ID 507f1f77bcf86cd799439011 not found',
        },
        error: { type: 'string', example: 'Not Found' },
      },
    },
  })
  public async getDataBatchById(
    @Param('batchId') batchId: string,
  ): Promise<IDataBatch> {
    return this.queryBus.execute(new GetDataBatchByIdQuery(batchId));
  }

  /**
   * Download enhanced record list
   */
  @Post('download-enhanced-record-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download enhanced records as Excel or zipped files',
  })
  @ApiProduces(
    'application/zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({
    status: 200,
    description:
      'Excel file with enhanced records, or a zip containing header and data sheets when applicable',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
      'application/zip': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No enhanced records found for this batch',
  })
  @Header('x-no-compression', 'true')
  public async downloadEnhancedRecordListAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<StreamableFile> {
    const { filePath, isZip } = await this.commandBus.execute(
      new DownloadBatchEnhancedRecordCommand(batchId),
    );

    const contentType = isZip
      ? 'application/zip'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const extension = isZip ? 'zip' : 'xlsx';

    return new StreamableFile(createReadStream(filePath), {
      type: contentType,
      disposition: `attachment; filename="enhanced-records-${batchId}.${extension}"`,
    });
  }

  /**
   * Download batch error list
   */
  @Post('download-batch-error-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download batch errors as Excel file' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({
    status: 200,
    description: 'Excel file with batch errors',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No errors found for this batch',
  })
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('x-no-compression', 'true')
  public async downloadErrorRecordListAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<StreamableFile> {
    const buffer = await this.commandBus.execute(
      new DownloadBatchErrorCommand(batchId),
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="batch-errors-${batchId}.xlsx"`,
    });
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
