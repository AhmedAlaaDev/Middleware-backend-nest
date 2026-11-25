import {
  CREDIT_NOTE_SETTLEMENT_LIMITS,
  isCreditNoteSettlementEnabled,
} from '@/modules/cash/credit-note-settlement/credit-note-settlement.constants';
import { CreditNoteSettlementService } from '@/modules/cash/credit-note-settlement/credit-note-settlement.service';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
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
  ProcessCashInShiplinkCommand,
  ProcessCashInYardCommand,
  ProcessCashOutFreightCommand,
  ProcessCashOutTruckingCommand,
  PostCashBatchToDFOCommand,
} from '@/modules/cash/commands';
import {
  CashInFreightDocDto,
  CashInTruckingDocDto,
  CashInShiplinkDocDto,
  CashInYardDocDto,
  CashOutFreightDocDto,
  CashOutTruckingDocDto,
  PostToDFODto,
  VendorPaymentSettlementUploadDto,
} from '@/modules/cash/dtos';
import {
  VendorPaymentSettlementImportResponse,
  VendorPaymentSettlementImportService,
} from '@/modules/cash/services/vendor-payment-settlement-import.service';
import { isShiplinkInvoiceUploadEnabled } from '@/modules/cash/yard-invoice/yard-invoice-flow';
import { isYardInvoiceUploadEnabled } from '@/modules/cash/yard-invoice/yard-invoice-preview.service';
import {
  YardInvoiceSubmitService,
  YardInvoiceUser,
} from '@/modules/cash/yard-invoice/yard-invoice-submit.service';
import { YardInvoiceTemplateError } from '@/modules/cash/yard-invoice/yard-invoice-template.parser';
import { YARD_INVOICE_LIMITS } from '@/modules/cash/yard-invoice/yard-invoice.constants';
import { ApplicationLogQueryService } from '@/modules/observability/services/application-log-query.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  QueuePauseState,
  QueueService,
} from '@/modules/queue/services/queue.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

type AuthenticatedRequest = { user?: { id?: string; role?: string } };

function assertYardInvoiceEnabled(): void {
  if (!isYardInvoiceUploadEnabled()) {
    throw new NotFoundException();
  }
}

function assertShiplinkInvoiceEnabled(): void {
  if (!isShiplinkInvoiceUploadEnabled()) {
    throw new NotFoundException();
  }
}

function requireYardInvoiceUser(req: AuthenticatedRequest): YardInvoiceUser {
  const id = String(req.user?.id ?? '').trim();
  if (!id) {
    throw new UnauthorizedException('Authentication is required');
  }
  return { id, role: req.user?.role };
}

/** Maps Yard upload errors to HTTP responses without leaking internals. */
function mapYardInvoiceError(error: unknown): unknown {
  if (error instanceof YardInvoiceTemplateError) {
    return new BadRequestException(error.message);
  }
  return error;
}

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
    private readonly vendorPaymentSettlements: VendorPaymentSettlementImportService,
    private readonly yardInvoiceSubmit: YardInvoiceSubmitService,
    private readonly creditNoteSettlement: CreditNoteSettlementService,
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

  /**
   * Cash-In Shiplink Document
   */
  @Post('CashIn-Shiplink-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInShiplinkDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInShiplinkDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInShiplinkDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInShiplinkCommand(file.buffer, companyId),
    );
  }

  /**
   * Credit note settlement: each row of the template pairs an open credit note
   * with the open invoice it reverses. The pairs are checked against D365 and
   * stored as a standard batch; nothing is posted here.
   * Gated by CREDIT_NOTE_SETTLEMENT_ENABLED.
   */
  @Post('CashIn-CreditNote-Settlement-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload the credit note settlement template (.xlsx) + company',
    type: CashInYardDocDto,
  })
  @ApiOperation({
    summary:
      'Check credit note and invoice pairs against D365 and create the settlement batch (posts nothing)',
  })
  @UseInterceptors(
    FileInterceptor('dataFile', {
      limits: {
        fileSize: CREDIT_NOTE_SETTLEMENT_LIMITS.maxFileBytes,
        files: 1,
      },
    }),
  )
  public async cashInCreditNoteSettlementDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInYardDocDto,
  ) {
    if (!isCreditNoteSettlementEnabled()) {
      throw new NotFoundException();
    }
    return this.creditNoteSettlement.upload({
      fileBuffer: file.buffer,
      fileName: file.originalname,
      companyId: companyId || 'm-p',
    });
  }

  /**
   * Cash-In Yard Document
   */
  @Post('CashIn-Yard-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInYardDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInYardDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInYardDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInYardCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-In Yard invoice upload: review. Accepts the eight-column template or a
   * Yards source workbook. The review runs in the background and creates a job;
   * the client polls the job and its lines. Nothing is posted here.
   * Gated by YARD_INVOICE_UPLOAD_ENABLED.
   */
  @Post('CashIn-Yard-Invoice-Preview')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload a Yard invoice workbook (.xlsx) + company',
    type: CashInYardDocDto,
  })
  @ApiOperation({
    summary:
      'Start an invoice-driven Yard cash-in review (creates a job, posts nothing)',
  })
  @UseInterceptors(
    FileInterceptor('dataFile', {
      limits: { fileSize: YARD_INVOICE_LIMITS.maxFileBytes, files: 1 },
    }),
  )
  public async previewYardInvoiceUpload(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInYardDocDto,
    @Req() req: AuthenticatedRequest,
  ) {
    assertYardInvoiceEnabled();
    const user = requireYardInvoiceUser(req);
    try {
      return await this.yardInvoiceSubmit.startReview({
        fileBuffer: file.buffer,
        fileName: file.originalname,
        companyId: companyId || 'm-p',
        user,
      });
    } catch (error) {
      throw mapYardInvoiceError(error);
    }
  }

  /**
   * ShipLink invoice upload: the same eight-column template and the same review
   * as Yard, with the ShipLink processor. Gated by SHIPLINK_INVOICE_UPLOAD_ENABLED.
   * The job, its lines and submit use the Yard routes below.
   */
  @Post('CashIn-Shiplink-Invoice-Preview')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload a ShipLink invoice workbook (.xlsx) + company',
    type: CashInShiplinkDocDto,
  })
  @ApiOperation({
    summary:
      'Start an invoice-driven ShipLink cash-in review (creates a job, posts nothing)',
  })
  @UseInterceptors(
    FileInterceptor('dataFile', {
      limits: { fileSize: YARD_INVOICE_LIMITS.maxFileBytes, files: 1 },
    }),
  )
  public async previewShiplinkInvoiceUpload(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInShiplinkDocDto,
    @Req() req: AuthenticatedRequest,
  ) {
    assertShiplinkInvoiceEnabled();
    const user = requireYardInvoiceUser(req);
    try {
      return await this.yardInvoiceSubmit.startReview({
        fileBuffer: file.buffer,
        fileName: file.originalname,
        companyId: companyId || 'm-p',
        user,
        flow: 'SHIPLINK',
      });
    } catch (error) {
      throw mapYardInvoiceError(error);
    }
  }

  /**
   * Cash-In Yard invoice upload: submit. The same file is reviewed again on the
   * server in the background and its payload hash must match the job. One batch
   * is created per job and queued through the existing cash posting command.
   */
  @Post('CashIn-Yard-Invoice-Jobs/:jobId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload the same workbook again to submit the reviewed job',
    type: CashInYardDocDto,
  })
  @ApiOperation({ summary: 'Submit a reviewed Yard invoice upload job' })
  @UseInterceptors(
    FileInterceptor('dataFile', {
      limits: { fileSize: YARD_INVOICE_LIMITS.maxFileBytes, files: 1 },
    }),
  )
  public async submitYardInvoiceJob(
    @Param('jobId') jobId: string,
    @ExcelFile() file: MulterFile,
    @Req() req: AuthenticatedRequest,
  ) {
    assertYardInvoiceEnabled();
    try {
      return await this.yardInvoiceSubmit.submit(
        jobId,
        file.buffer,
        requireYardInvoiceUser(req),
      );
    } catch (error) {
      throw mapYardInvoiceError(error);
    }
  }

  /** Cash-In Yard invoice upload: job state, summary and batch status. */
  @Get('CashIn-Yard-Invoice-Jobs/:jobId')
  @ApiOperation({ summary: 'Get a Yard invoice upload job' })
  public async getYardInvoiceJob(
    @Param('jobId') jobId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    assertYardInvoiceEnabled();
    try {
      return await this.yardInvoiceSubmit.getJob(
        jobId,
        requireYardInvoiceUser(req),
      );
    } catch (error) {
      throw mapYardInvoiceError(error);
    }
  }

  /** Cash-In Yard invoice upload: one page of reviewed invoices. */
  @Get('CashIn-Yard-Invoice-Jobs/:jobId/invoices')
  @ApiOperation({
    summary: 'Get one page of reviewed invoices for a Yard upload job',
  })
  public async getYardInvoiceJobLines(
    @Param('jobId') jobId: string,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    assertYardInvoiceEnabled();
    try {
      return await this.yardInvoiceSubmit.getLines(
        jobId,
        requireYardInvoiceUser(req),
        Math.max(1, Number(page ?? 1) || 1),
        Math.max(1, Math.min(Number(pageSize ?? 100) || 100, 500)),
      );
    } catch (error) {
      throw mapYardInvoiceError(error);
    }
  }

  /**
   * Mark existing vendor-payment journal lines from a D365 Excel export.
   * Every row is checked against the live journal line and open invoice before
   * a settlement record is created. Existing records are skipped safely.
   */
  @Post('VendorPayment-Settlement-Document')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Upload a vendor payment journal Excel export and optionally validate it without posting.',
    type: VendorPaymentSettlementUploadDto,
  })
  @ApiOperation({
    summary: 'Settle vendor-payment journal lines from an Excel export',
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public settleVendorPaymentsFromExcel(
    @ExcelFile() file: MulterFile,
    @Body() body: VendorPaymentSettlementUploadDto,
  ): Promise<VendorPaymentSettlementImportResponse> {
    return this.vendorPaymentSettlements.process(file.buffer, body.dryRun);
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
