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
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiProduces,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import type {
  IMissingMasterDataPaginatedResponse,
  IRemediationSummary,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { Auth } from '@/modules/auth/decorators/auth.decorator';
import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
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
import { ShiplinkSettlementBatchDto } from '@/modules/data-batch/dtos/shiplink-settlement-batch.dto';
import { ShiplinkSettlementExcelDto } from '@/modules/data-batch/dtos/shiplink-settlement-excel.dto';
import { BatchOwnerOrAdminGuard } from '@/modules/data-batch/guards/batch-owner-or-admin.guard';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { GetDataBatchByIdQuery } from '@/modules/data-batch/queries/get-data-batch-by-id.query';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { GetMissingMasterDataQuery } from '@/modules/data-batch/queries/get-missing-master-data.query';
import { GetRemediationSummaryQuery } from '@/modules/data-batch/queries/get-remediation-summary.query';
import {
  ShiplinkSettlementDifferenceReport,
  ShiplinkSettlementExcelReport,
  ShiplinkSettlementPayload,
  ShiplinkSettlementPayloadExportService,
  ShiplinkSettlementPostReport,
  ShiplinkUnsettledLinesReport,
} from '@/modules/data-batch/services/shiplink-settlement-payload-export.service';
import { DataBatchReprocessSubmission } from '@/modules/queue/contracts/data-batch-reprocess-job.contract';
import { BatchPostingPauseState } from '@/modules/queue/services/batch-posting-control.service';
import { IUser } from '@/modules/user/interfaces/user.interface';

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
    private readonly shiplinkSettlementPayloads: ShiplinkSettlementPayloadExportService,
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

  /** Download exact D365 settlement bodies for a posted Shiplink batch. */
  @Post('download-shiplink-settlement-payloads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download Shiplink settlement payloads for Postman Runner',
    description:
      'Reads the real Finance journal batch and line numbers, resolves invoice due dates, and returns a JSON array with one PaymentJournalLineSettledInvoices body per Shiplink customer line.',
  })
  @ApiProduces('application/json')
  @ApiResponse({
    status: 200,
    description: 'JSON array of settlement payloads',
    content: { 'application/json': { schema: { type: 'array' } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Batch is not a posted Shiplink batch or a Finance value is missing',
  })
  @Header('x-no-compression', 'true')
  public async downloadShiplinkSettlementPayloadsAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<StreamableFile> {
    const payloads = await this.shiplinkSettlementPayloads.export(batchId);
    return new StreamableFile(
      Buffer.from(JSON.stringify(payloads, null, 2), 'utf8'),
      {
        type: 'application/json',
        disposition: `attachment; filename="shiplink-settlement-payloads-${batchId}.postman_data.json"`,
      },
    );
  }

  /** Return exact settlement request bodies as JSON for Postman Runner. */
  @Post('shiplink-settlement-payloads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Shiplink settlement request bodies',
    description:
      'Returns one exact PaymentJournalLineSettledInvoices body per Shiplink customer line. Values are read from Finance after posting.',
  })
  @ApiResponse({ status: 200, description: 'Settlement payload array' })
  public getShiplinkSettlementPayloadsAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<ShiplinkSettlementPayload[]> {
    return this.shiplinkSettlementPayloads.export(batchId);
  }

  /** Filter a pasted SettlementLines.json array by its Dynamics batch number. */
  @Post('shiplink-settlement-payloads/filter-by-journal-batch')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'journalBatchNumber',
    example: 'Mesco-000016627',
    description: 'The Dynamics-generated journal batch number to return.',
  })
  @ApiBody({
    schema: {
      type: 'array',
      description: 'The complete SettlementLines.json array.',
      items: { type: 'object' },
    },
  })
  @ApiProduces('application/json')
  @ApiOperation({
    summary: 'Filter pasted Shiplink settlement JSON by journal batch',
    description:
      'Paste the complete SettlementLines.json array as the raw request body and pass the selected Dynamics batch in journalBatchNumber. The response contains only that batch, ready for the PaymentJournalLineSettledInvoices endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Filtered settlement payload array',
  })
  public filterPastedShiplinkSettlementPayloadsAsync(
    @Query('journalBatchNumber') journalBatchNumber: string,
    @Body() body: unknown,
  ): StreamableFile {
    const payloads =
      this.shiplinkSettlementPayloads.filterUploadedPayloadsByJournalBatch(
        body,
        journalBatchNumber,
      );
    return new StreamableFile(
      Buffer.from(JSON.stringify(payloads, null, 2), 'utf8'),
      {
        type: 'application/json',
        disposition: 'attachment; filename="shiplink-settlement-payloads.json"',
      },
    );
  }

  /**
   * Post a generated batch JSON array, one line at a time, to D365FO
   * PaymentJournalLineSettledInvoices.
   */
  @Post('shiplink-settlement/post-lines')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: 'array',
      description:
        'The generated settlement JSON array for one journal, for example Mesco-000015882.json.',
      items: { type: 'object' },
    },
  })
  @ApiOperation({
    summary: 'Post pasted settlement JSON lines to Finance',
    description:
      'Accepts the generated PaymentJournalLineSettledInvoices JSON array and posts one request per line to /data/PaymentJournalLineSettledInvoices. Open-invoice due dates are resolved from Finance before each write. Existing exact rows are skipped and individual failures do not stop the remaining rows.',
  })
  @ApiResponse({ status: 200, description: 'Settlement posting report' })
  public settleUploadedPayloadsAsync(
    @Body() body: unknown,
  ): Promise<ShiplinkSettlementPostReport> {
    return this.shiplinkSettlementPayloads.settleUploadedPayloads(body);
  }

  /** Post every line in the selected batch from a pasted settlement array. */
  @Post('shiplink-settlement/post-selected-batch')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'journalBatchNumber',
    required: false,
    example: 'Mesco-000015882',
    description:
      'Optional. When omitted, every row in the pasted JSON is posted. When the pasted file is already one journal, a mismatched query still posts that journal.',
  })
  @ApiBody({
    schema: {
      type: 'array',
      description: 'The complete SettlementLines.json array.',
      items: { type: 'object' },
    },
  })
  @ApiOperation({
    summary: 'Post the selected Shiplink batch settlement lines',
    description:
      'Paste the complete SettlementLines.json array and select one Dynamics batch. Every selected row is posted to PaymentJournalLineSettledInvoices. Exact existing rows are skipped, amount mismatches are reported, and individual failures do not stop the remaining rows.',
  })
  @ApiResponse({ status: 200, description: 'Settlement posting report' })
  public settlePastedShiplinkBatchAsync(
    @Query('journalBatchNumber') journalBatchNumber: string,
    @Body() body: unknown,
  ): Promise<ShiplinkSettlementPostReport> {
    return this.shiplinkSettlementPayloads.settleUploadedPayloadsByJournalBatch(
      body,
      journalBatchNumber,
    );
  }

  /**
   * Build and post Shiplink settlement lines from the enhanced cash-in
   * workbook plus the invoice due-date workbook.
   */
  @Post('shiplink-settlement/from-excel')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ShiplinkSettlementExcelDto })
  @ApiQuery({
    name: 'journalBatchNumber',
    required: false,
    example: 'Mesco-000015882',
    description:
      'Optional. When omitted, every journal in the enhanced workbook is settled.',
  })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    example: false,
    description:
      'When true, return the PaymentJournalLineSettledInvoices bodies without posting them.',
  })
  @ApiOperation({
    summary: 'Settle Shiplink journals from enhanced records and invoice Excel files',
    description:
      'Reads customer payment lines from the enhanced workbook, keeps rows that exist in the Shiplink cash-in/invoice workbook, then posts each line to PaymentJournalLineSettledInvoices. Existing exact marks are skipped, open-invoice due dates are resolved from Finance before each write, and individual failures do not stop the remaining rows.',
  })
  @ApiResponse({ status: 200, description: 'Settlement posting report' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'enhancedRecords', maxCount: 1 },
        { name: 'invoiceFile', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 100 * 1024 * 1024, files: 2 },
      },
    ),
  )
  public settleShiplinkFromExcelAsync(
    @UploadedFiles()
    files: {
      enhancedRecords?: Express.Multer.File[];
      invoiceFile?: Express.Multer.File[];
    },
    @Body() body: ShiplinkSettlementExcelDto,
    @Query('journalBatchNumber') journalBatchNumber?: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<ShiplinkSettlementExcelReport> {
    const enhanced = files?.enhancedRecords?.[0];
    const invoices = files?.invoiceFile?.[0];
    if (!enhanced?.buffer?.length) {
      throw new BadRequestException('enhancedRecords Excel file is required.');
    }
    if (!invoices?.buffer?.length) {
      throw new BadRequestException('invoiceFile Excel file is required.');
    }
    this.assertExcelUpload(enhanced, 'enhancedRecords');
    this.assertExcelUpload(invoices, 'invoiceFile');
    return this.shiplinkSettlementPayloads.settleFromExcelFiles(
      enhanced.buffer,
      invoices.buffer,
      {
        journalBatchNumber: journalBatchNumber || body.journalBatchNumber,
        dryRun: dryRun === 'true' || dryRun === '1' || body.dryRun === true,
      },
    );
  }

  /** Return settlement bodies using the Finance-generated journal number. */
  @Post('shiplink-settlement-payloads/by-journal-batch')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ShiplinkSettlementBatchDto })
  @ApiOperation({
    summary: 'Get Shiplink settlement bodies by Finance journal batch number',
    description:
      'Pass the internal Dynamics journal batch number, for example Mesco-000016627. The response is an array of exact PaymentJournalLineSettledInvoices request bodies.',
  })
  @ApiResponse({ status: 200, description: 'Settlement payload array' })
  public getShiplinkSettlementPayloadsByJournalBatchAsync(
    @Body() { journalBatchNumber }: ShiplinkSettlementBatchDto,
  ): Promise<ShiplinkSettlementPayload[]> {
    return this.shiplinkSettlementPayloads.exportByJournalBatchNumber(
      journalBatchNumber,
    );
  }

  /** Settle all missing Shiplink lines for a Finance journal batch. */
  @Post('shiplink-settlement/by-journal-batch')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ShiplinkSettlementBatchDto })
  @ApiOperation({
    summary: 'Settle a Shiplink Finance journal batch',
    description:
      'Resolves the exact settlement bodies for the supplied Finance journal number and posts only missing rows to PaymentJournalLineSettledInvoices. Existing exact rows are skipped and amount mismatches are reported.',
  })
  @ApiResponse({ status: 200, description: 'Settlement posting report' })
  public settleShiplinkByJournalBatchAsync(
    @Body() { journalBatchNumber }: ShiplinkSettlementBatchDto,
  ): Promise<ShiplinkSettlementPostReport> {
    return this.shiplinkSettlementPayloads.settleByJournalBatchNumber(
      journalBatchNumber,
    );
  }

  /** Compare expected Shiplink settlement bodies with current D365 marks. */
  @Post('shiplink-settlement-difference')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check Shiplink settlement differences',
    description:
      'Reports settled rows, missing settlement rows, amount mismatches, extra D365 settlement rows, and amount totals.',
  })
  @ApiResponse({ status: 200, description: 'Settlement difference report' })
  public getShiplinkSettlementDifferenceAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<ShiplinkSettlementDifferenceReport> {
    return this.shiplinkSettlementPayloads.getDifferenceReport(batchId);
  }

  /** Return the exact rows that remain unsettled in Finance. */
  @Post('shiplink-unsettled-lines')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get unsettled Shiplink lines',
    description:
      'Returns missing and mismatched settlement lines, including real Finance vouchers and batch numbers, plus Finance lines not represented by the expected payload set.',
  })
  @ApiResponse({ status: 200, description: 'Unsettled Shiplink line report' })
  public getShiplinkUnsettledLinesAsync(
    @Body() { batchId }: BatchIdDto,
  ): Promise<ShiplinkUnsettledLinesReport> {
    return this.shiplinkSettlementPayloads.getUnsettledLines(batchId);
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(BatchOwnerOrAdminGuard)
  @RequireBatchOwnerOrAdmin('delete')
  public async deleteAsync(
    @Query() { batchId }: BatchIdDto,
    @Auth() user: Omit<IUser, 'passwordHash'>,
  ): Promise<void> {
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

  private actorFrom(user: Omit<IUser, 'passwordHash'>) {
    return {
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      email: user.email,
    };
  }

  private assertExcelUpload(file: Express.Multer.File, field: string): void {
    const name = String(file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      throw new BadRequestException(
        `${field} must be an Excel workbook (.xlsx).`,
      );
    }
  }
}
