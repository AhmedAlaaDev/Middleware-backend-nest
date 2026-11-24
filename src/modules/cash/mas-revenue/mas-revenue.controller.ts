import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  buildMasJournalTemplate,
  buildMasJournalUploadGuide,
} from './mas-journal-template';
import { MAS_JOURNAL_TEMPLATE_VERSION } from './mas-journal-template.constants';
import {
  MasRevenueReviewService,
  MasRevenueUser,
} from './mas-revenue-review.service';
import {
  buildMasRevenueTemplate,
  buildMasRevenueUploadGuide,
} from './mas-revenue-template';
import {
  MAS_REVENUE_LIMITS,
  MAS_REVENUE_TEMPLATE_VERSION_LABEL,
  masRevenueTemplateFileName,
} from './mas-revenue.constants';
import {
  MasRevenueLinesQueryDto,
  MasRevenuePreviewDto,
  MasRevenueSubmitDto,
} from './mas-revenue.dto';

import type { Response } from 'express';

import { ExcelFile } from '@/common/decorators';

type AuthenticatedRequest = { user?: { id?: string; role?: string } };

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function requireUser(req: AuthenticatedRequest): MasRevenueUser {
  const id = String(req.user?.id ?? '').trim();
  if (!id) {
    throw new UnauthorizedException('Authentication is required');
  }
  return { id, role: req.user?.role };
}

/**
 * MAS Revenue Cash In. Template, guide, staged review and batch creation.
 * Sending the batch to D365 uses the existing PostToDFO route, so posting stays
 * a separate, explicit step.
 */
@ApiTags('Cash In - MAS Revenue')
@ApiBearerAuth()
@Controller('DataMigration/Cash')
export class MasRevenueController {
  constructor(private readonly reviews: MasRevenueReviewService) {}

  @Get('CashIn-MAS-Revenue-Template')
  @ApiOperation({
    summary: 'Download the clean MAS Revenue Cash In upload template (.xlsx)',
  })
  public async downloadTemplate(@Res({ passthrough: true }) res: Response) {
    const buffer = await buildMasRevenueTemplate();
    res.setHeader('X-Template-Version', MAS_REVENUE_TEMPLATE_VERSION_LABEL);
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${masRevenueTemplateFileName()}"`,
      length: buffer.length,
    });
  }

  @Get('CashIn-MAS-Journal-Template')
  @ApiOperation({
    summary:
      'Download the MAS petty-cash journal-lines template (.xlsx, version 2)',
  })
  public async downloadJournalTemplate(
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await buildMasJournalTemplate();
    res.setHeader('X-Template-Version', String(MAS_JOURNAL_TEMPLATE_VERSION));
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="MAS-Journal-Lines-Template-v${MAS_JOURNAL_TEMPLATE_VERSION}.xlsx"`,
      length: buffer.length,
    });
  }

  @Get('CashIn-MAS-Journal-Guide')
  @ApiOperation({
    summary: 'Download the MAS journal-lines upload guide (Markdown)',
  })
  public downloadJournalGuide(@Res({ passthrough: true }) res: Response) {
    const text = Buffer.from(buildMasJournalUploadGuide(), 'utf8');
    res.setHeader('X-Template-Version', String(MAS_JOURNAL_TEMPLATE_VERSION));
    return new StreamableFile(text, {
      type: 'text/markdown; charset=utf-8',
      disposition: `attachment; filename="MAS-Journal-Lines-Guide-v${MAS_JOURNAL_TEMPLATE_VERSION}.md"`,
      length: text.length,
    });
  }

  @Get('CashIn-MAS-Revenue-Guide')
  @ApiOperation({
    summary: 'Download the MAS Revenue Cash In upload guide (Markdown)',
  })
  public downloadGuide(@Res({ passthrough: true }) res: Response) {
    const text = Buffer.from(buildMasRevenueUploadGuide(), 'utf8');
    res.setHeader('X-Template-Version', MAS_REVENUE_TEMPLATE_VERSION_LABEL);
    return new StreamableFile(text, {
      type: 'text/markdown; charset=utf-8',
      disposition: `attachment; filename="MAS-Revenue-Cash-In-Guide-${MAS_REVENUE_TEMPLATE_VERSION_LABEL}.md"`,
      length: text.length,
    });
  }

  /**
   * Stage 1 (review). Parses and validates the workbook and stores an immutable
   * snapshot. Creates no batch and sends nothing to D365.
   */
  @Post('CashIn-MAS-Revenue-Preview')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      "MAS workbook (.xlsx) with companyId and templateVersion. Currency comes from each receipt's D365 cash account.",
    type: MasRevenuePreviewDto,
  })
  @ApiOperation({
    summary:
      'Review a MAS Revenue upload (creates a review snapshot, posts nothing)',
  })
  @UseInterceptors(
    FileInterceptor('dataFile', {
      limits: { fileSize: MAS_REVENUE_LIMITS.maxFileBytes, files: 1 },
    }),
  )
  public async preview(
    @ExcelFile() file: MulterFile,
    @Body() body: MasRevenuePreviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('dataFile is required');
    }
    return this.reviews.preview({
      fileBuffer: file.buffer,
      fileName: file.originalname,
      companyId: body.companyId,
      templateVersion: Number(body.templateVersion),
      user: requireUser(req),
    });
  }

  @Get('CashIn-MAS-Revenue-Reviews/:reviewId')
  @ApiOperation({
    summary: 'Read a MAS Revenue review, its totals and its submit blockers',
  })
  public getReview(
    @Param('reviewId') reviewId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviews.getReview(reviewId, requireUser(req));
  }

  @Get('CashIn-MAS-Revenue-Reviews/:reviewId/lines')
  @ApiOperation({
    summary: 'Page the accepted receipts of a MAS Revenue review',
  })
  public getLines(
    @Param('reviewId') reviewId: string,
    @Query() query: MasRevenueLinesQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviews.getLines(
      reviewId,
      requireUser(req),
      query.page ?? 1,
      query.pageSize ?? 50,
    );
  }

  /**
   * Stage 2 (batch). Creates the Cash In batch from the reviewed snapshot. Nothing
   * is sent to D365 here; send the batch with PostToDFO.
   */
  @Post('CashIn-MAS-Revenue-Reviews/:reviewId/submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the Cash In batch from a reviewed MAS Revenue snapshot',
  })
  public submit(
    @Param('reviewId') reviewId: string,
    @Body() body: MasRevenueSubmitDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviews.submit(
      reviewId,
      {
        reviewVersion: Number(body.reviewVersion),
        payloadHash: body.payloadHash,
        idempotencyKey: body.idempotencyKey,
      },
      requireUser(req),
    );
  }
}
