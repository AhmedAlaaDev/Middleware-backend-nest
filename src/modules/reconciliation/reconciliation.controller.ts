import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ReconciliationService } from './reconciliation.service';
import { ReconciliationReport } from './types';

import type { Response } from 'express';

const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 2 },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const valid = /\.xlsx$/i.test(file.originalname);
    callback(
      valid ? null : new BadRequestException('Only .xlsx files are supported.'),
      valid,
    );
  },
};

interface StoredDownload {
  buffer: Buffer;
  filename: string;
  expiresAt: number;
}

@Controller('reconciliation')
export class ReconciliationController {
  private readonly downloads = new Map<string, StoredDownload>();

  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'istFile', maxCount: 1 },
        { name: 'bankFile', maxCount: 1 },
      ],
      uploadOptions,
    ),
  )
  async upload(
    @UploadedFiles()
    files: {
      istFile?: Express.Multer.File[];
      bankFile?: Express.Multer.File[];
    },
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const istFile = files?.istFile?.[0];
    const bankFile = files?.bankFile?.[0];
    if (!istFile || !bankFile) {
      throw new BadRequestException('Both istFile and bankFile are required.');
    }

    const result = await this.reconciliationService.reconcile(
      istFile.buffer,
      bankFile.buffer,
      this.reconciliationService.parseOptions(body),
    );
    const baseName = istFile.originalname.replace(/\.xlsx$/i, '');
    const outputName = `${baseName}-reconciled.xlsx`;
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${outputName.replace(/["\r\n]/g, '')}"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(result);
  }

  @Post('process')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'istFile', maxCount: 1 },
        { name: 'bankFile', maxCount: 1 },
      ],
      uploadOptions,
    ),
  )
  async process(
    @UploadedFiles()
    files: {
      istFile?: Express.Multer.File[];
      bankFile?: Express.Multer.File[];
    },
    @Body() body: Record<string, unknown>,
  ): Promise<{
    downloadId: string;
    filename: string;
    report: ReconciliationReport;
  }> {
    const istFile = files?.istFile?.[0];
    const bankFile = files?.bankFile?.[0];
    if (!istFile || !bankFile) {
      throw new BadRequestException('Both istFile and bankFile are required.');
    }
    const output = await this.reconciliationService.reconcileWithReport(
      istFile.buffer,
      bankFile.buffer,
      this.reconciliationService.parseOptions(body),
    );
    const filename = `${istFile.originalname.replace(/\.xlsx$/i, '')}-reconciled.xlsx`;
    const downloadId = randomUUID();
    this.cleanupDownloads();
    this.downloads.set(downloadId, {
      buffer: output.workbook,
      filename,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    return { downloadId, filename, report: output.report };
  }

  @Get('download/:id')
  download(@Param('id') id: string, @Res() response: Response): void {
    this.cleanupDownloads();
    const stored = this.downloads.get(id);
    if (!stored)
      throw new NotFoundException(
        'This download has expired. Run reconciliation again.',
      );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${stored.filename.replace(/["\r\n]/g, '')}"`,
    );
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.send(stored.buffer);
  }

  private cleanupDownloads(): void {
    const now = Date.now();
    for (const [id, stored] of this.downloads) {
      if (stored.expiresAt <= now) this.downloads.delete(id);
    }
  }
}
