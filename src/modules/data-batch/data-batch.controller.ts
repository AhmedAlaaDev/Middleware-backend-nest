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
  UseGuards,
  BadRequestException,
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

import type {
  IMissingMasterDataPaginatedResponse,
  IRemediationSummary,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { Auth } from '@/modules/auth/decorators/auth.decorator';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DeleteDfoJournalCommand } from '@/modules/data-batch/commands/delete-dfo-journal.command';
import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { DownloadBatchSourceRecordCommand } from '@/modules/data-batch/commands/download-batch-source-record.command';
import { ReprocessBatchCommand } from '@/modules/data-batch/commands/reprocess-batch.command';
import { SetBatchPostingPauseCommand } from '@/modules/data-batch/commands/set-batch-posting-pause.command';
import { RequireBatchOwnerOrAdmin } from '@/modules/data-batch/decorators/batch-owner-action.decorator';
import { BatchIdDto } from '@/modules/data-batch/dtos/batch-id.dto';
import { DataBatchErrorListDto } from '@/modules/data-batch/dtos/data-batch-error-list.dto';
import { DataBatchListDto } from '@/modules/data-batch/dtos/data-batch-list.dto';
import { GetMissingMasterDataDto } from '@/modules/data-batch/dtos/get-missing-master-data.dto';
import { BatchOwnerOrAdminGuard } from '@/modules/data-batch/guards/batch-owner-or-admin.guard';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { GetBatchResponseBodyQuery } from '@/modules/data-batch/queries/get-batch-response-body.query';
import { GetDataBatchByIdQuery } from '@/modules/data-batch/queries/get-data-batch-by-id.query';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { GetJournalIntegrityQuery } from '@/modules/data-batch/queries/get-journal-integrity.query';
import { GetMissingMasterDataQuery } from '@/modules/data-batch/queries/get-missing-master-data.query';
import { GetRemediationSummaryQuery } from '@/modules/data-batch/queries/get-remediation-summary.query';
import { DataBatchReprocessSubmission } from '@/modules/queue/contracts/data-batch-reprocess-job.contract';
import { BatchPostingPauseState } from '@/modules/queue/services/batch-posting-control.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserRole } from '@/modules/user/schemas/user.schema';

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
    @Query() { batchId, maxCount, skipCount }: DataBatchErrorListDto,
  ): Promise<IPaginatedRes<IDataBatchError>> {
    return this.queryBus.execute(
      new GetBatchErrorListQuery(batchId, skipCount, maxCount),
    );
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
    const filePath = await this.commandBus.execute(
      new DownloadBatchErrorCommand(batchId),
    );
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="batch-errors-${batchId}.xlsx"`,
    });
  }

  /**
   * Download source record list (stored raw data as Excel)
   */
  @Post('download-source-file')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download source records as Excel file',
    description:
      'Streams the stored raw source records for the batch (e.g. from AR Freight upload) as an Excel file. Memory-efficient.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({
    status: 200,
    description: 'Excel file with source records',
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
    description: 'No source records found for this batch',
  })
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('x-no-compression', 'true')
  public async downloadSourceFileAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<StreamableFile> {
    const filePath = await this.commandBus.execute(
      new DownloadBatchSourceRecordCommand(batchId),
    );
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="source-records-${batchId}.xlsx"`,
    });
  }

  /**
   * Delete a batch with all related entities
   */
  @Delete()
  @Delete(':batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(BatchOwnerOrAdminGuard)
  @RequireBatchOwnerOrAdmin('delete')
  public async deleteAsync(
    @Query('batchId') queryBatchId: string | undefined,
    @Param('batchId') paramBatchId: string | undefined,
    @Body('batchId') bodyBatchId: string | undefined,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<void> {
    const batchId = paramBatchId || queryBatchId || bodyBatchId;
    if (!batchId) {
      throw new BadRequestException('Batch ID is required');
    }
    await this.commandBus.execute(
      new DeleteBatchCommand(batchId, this.actorFrom(user)),
    );
  }

  /**
   * Get missing master data items for a batch (paginated)
   */
  @Get(':batchId/missing-master-data')
  @ApiOperation({
    summary: 'Get paginated list of missing master data items for a batch',
  })
  public async getMissingMasterDataAsync(
    @Param('batchId') batchId: string,
    @Query() query: GetMissingMasterDataDto,
  ): Promise<IMissingMasterDataPaginatedResponse> {
    return this.queryBus.execute(
      new GetMissingMasterDataQuery(
        batchId,
        query.type,
        query.creationStatus,
        query.page ?? 1,
        query.limit ?? 30,
        query.search,
      ),
    );
  }

  /**
   * Get lightweight remediation summary for a batch
   */
  @Get(':batchId/remediation-summary')
  @ApiOperation({
    summary: 'Get remediation summary counts for a batch',
  })
  public async getRemediationSummaryAsync(
    @Param('batchId') batchId: string,
  ): Promise<IRemediationSummary> {
    return this.queryBus.execute(new GetRemediationSummaryQuery(batchId));
  }

  /**
   * Trigger manual batch reprocessing
   */
  @Post(':batchId/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprocess a data batch' })
  @UseGuards(BatchOwnerOrAdminGuard)
  @RequireBatchOwnerOrAdmin('reprocess')
  public async reprocessBatchAsync(
    @Param('batchId') batchId: string,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<DataBatchReprocessSubmission> {
    return this.commandBus.execute(
      new ReprocessBatchCommand(batchId, this.actorFrom(user)),
    );
  }

  /**
   * Hold the batch back from being posted to D365FO. A worker that is already
   * posting it stops after the journal it is currently writing.
   */
  @Post(':batchId/posting/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause posting a data batch to D365FO' })
  @UseGuards(BatchOwnerOrAdminGuard)
  @RequireBatchOwnerOrAdmin('pause posting for')
  public async pausePostingAsync(
    @Param('batchId') batchId: string,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<BatchPostingPauseState> {
    return this.commandBus.execute(
      new SetBatchPostingPauseCommand(batchId, true, this.actorFrom(user)),
    );
  }

  /**
   * Let a paused batch continue. Journals that were already posted are kept and
   * only the pending ones are sent.
   */
  @Post(':batchId/posting/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume posting a data batch to D365FO' })
  @UseGuards(BatchOwnerOrAdminGuard)
  @RequireBatchOwnerOrAdmin('resume posting for')
  public async resumePostingAsync(
    @Param('batchId') batchId: string,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<BatchPostingPauseState> {
    return this.commandBus.execute(
      new SetBatchPostingPauseCommand(batchId, false, this.actorFrom(user)),
    );
  }

  /**
   * Get full response body, D365FO HTTP request/response payloads, and application logs for a batch ID or journal number
   */
  @Get(':batchId/response-body')
  @Public()
  @ApiOperation({
    summary: 'Get full response body and application logs for a batch',
    description:
      'Retrieves full application logs, captured D365FO HTTP request/response bodies, posting errors, and batch status for the specified batch ID or journal number.',
  })
  @ApiParam({
    name: 'batchId',
    description:
      'The batch ID or journal batch number (e.g. 6a781281bca6423be5cc93c6 or Mesco-000013814)',
    type: String,
    example: '6a781281bca6423be5cc93c6',
  })
  public async getBatchResponseBody(
    @Param('batchId') batchId: string,
  ): Promise<any> {
    return this.queryBus.execute(new GetBatchResponseBodyQuery(batchId));
  }

  /**
   * Alias endpoint for getting batch response body and logs
   */
  @Get(':batchId/logs')
  @Public()
  @ApiOperation({
    summary: 'Get application logs and response bodies for a batch (alias)',
  })
  public async getBatchLogs(@Param('batchId') batchId: string): Promise<any> {
    return this.queryBus.execute(new GetBatchResponseBodyQuery(batchId));
  }

  /**
   * Get live D365FO headers, line items, and logs for a journal batch number (e.g. Mesco-000013814)
   */
  @Get('journal-batch/:journalBatchNumber')
  @Public()
  @ApiOperation({
    summary:
      'Get live D365FO headers, line items, and logs for a journal batch number',
    description:
      'Queries Dynamics 365 FO live OData API directly for the specified JournalBatchNumber (e.g. Mesco-000013814) and returns full header, line items, and logs.',
  })
  @ApiParam({
    name: 'journalBatchNumber',
    description: 'The D365FO journal batch number (e.g. Mesco-000013814)',
    type: String,
    example: 'Mesco-000013814',
  })
  public async getJournalBatchDfoResponse(
    @Param('journalBatchNumber') journalBatchNumber: string,
  ): Promise<any> {
    return this.queryBus.execute(
      new GetBatchResponseBodyQuery(journalBatchNumber),
    );
  }

  @Get('journal-batch/:journalBatchNumber/integrity')
  @Public()
  @ApiOperation({
    summary: 'Validate a D365FO journal amount, line count, and duplication',
    description:
      'Returns the complete live D365FO header and lines, compares Finance debit/credit totals and line count with the durable middleware request, and reports duplicate line numbers or potential duplicated business rows.',
  })
  @ApiParam({
    name: 'journalBatchNumber',
    description: 'The D365FO journal batch number',
    type: String,
    example: 'Mesco-000014742',
  })
  public async getJournalIntegrity(
    @Param('journalBatchNumber') journalBatchNumber: string,
  ): Promise<any> {
    return this.queryBus.execute(
      new GetJournalIntegrityQuery(journalBatchNumber),
    );
  }

  @Delete('journal-batch/:journalBatchNumber')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a D365FO journal by JournalBatchNumber',
    description:
      'Finds the journal in Finance (Vendor Payment, Ledger, Customer Payment, or Vendor Invoice), deletes dependent lines, then deletes the header. Use this to clear SpecTrans blockers left by failed cash-out posts. Posted journals may be rejected by Finance.',
  })
  @ApiParam({
    name: 'journalBatchNumber',
    description: 'The D365FO journal batch number (e.g. Mesco-000014781)',
    type: String,
    example: 'Mesco-000014781',
  })
  @ApiResponse({
    status: 200,
    description: 'Journal deleted from Finance',
  })
  @ApiResponse({
    status: 404,
    description: 'No journal header found for that number/company',
  })
  public async deleteDfoJournal(
    @Param('journalBatchNumber') journalBatchNumber: string,
    @Query('company') company: string | undefined,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<{
    deleted: boolean;
    entityType?: string;
    company: string;
    journalBatchNumber: string;
  }> {
    return this.commandBus.execute(
      new DeleteDfoJournalCommand(
        journalBatchNumber,
        company?.trim() || 'm-p',
        this.actorFrom(user),
      ),
    );
  }

  private actorFrom(user: Omit<IUser, 'passwordHash'>) {
    return {
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      email: user.email,
    };
  }
}
