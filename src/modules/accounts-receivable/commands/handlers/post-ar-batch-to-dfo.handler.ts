import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import {
  PostARBatchToDFOCommand,
  PostARBatchToDFOResult,
} from '../post-ar-batch-to-dfo.command';

import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(PostARBatchToDFOCommand)
@Injectable()
export class PostARBatchToDFOHandler implements ICommandHandler<
  PostARBatchToDFOCommand,
  PostARBatchToDFOResult
> {
  private readonly logger = new Logger(PostARBatchToDFOHandler.name);

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: PostARBatchToDFOCommand,
  ): Promise<PostARBatchToDFOResult> {
    const { batchId } = command;

    this.logger.log(`Starting post to DFO for batch ${batchId}`);

    const batch = await this.validateBatch(batchId);

    const invoiceGroups = await this.groupRecordsByFreeTextNumber(batchId);

    const groupedInvoices = this.mapToD365FORequests(
      invoiceGroups,
      batch.company,
    );

    this.validateInvoices(groupedInvoices);
    Logger.debug('groupedInvoices', groupedInvoices);

    return {
      jobId: '',
      message: '',
    };

    await this.prepareBatchForPosting(batchId);

    return await this.enqueuePostingJob(batchId, batch.company, [
      groupedInvoices[0],
    ]);
  }

  /**
   * Validates that the batch exists
   */
  private async validateBatch(batchId: string) {
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    return batch;
  }

  /**
   * Groups enhanced records by FreeTextNumber using cursor streaming (memory-efficient)
   */
  private async groupRecordsByFreeTextNumber(
    batchId: string,
  ): Promise<Map<string, IDataEnhancedRecord<DynAccountReceivableLineDto>[]>> {
    const cursor = this.dataBatchService.getEnhancedRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    const invoiceGroups = new Map<
      string,
      IDataEnhancedRecord<DynAccountReceivableLineDto>[]
    >();
    let recordCount = 0;

    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data as unknown as DynAccountReceivableLineDto;

      if (!this.isValidRecord(data, record.id)) {
        continue;
      }

      const freeTextNumber = data.FreeTextNumber;
      if (!invoiceGroups.has(freeTextNumber)) {
        invoiceGroups.set(freeTextNumber, []);
      }

      invoiceGroups
        .get(freeTextNumber)!
        .push(
          record as unknown as IDataEnhancedRecord<DynAccountReceivableLineDto>,
        );
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Grouped ${recordCount} records into ${invoiceGroups.size} invoices`,
    );

    return invoiceGroups;
  }

  /**
   * Checks if a record is valid for processing
   */
  private isValidRecord(
    data: DynAccountReceivableLineDto,
    recordId: string,
  ): data is DynAccountReceivableLineDto {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const lineDto = data;
    if (!lineDto.FreeTextNumber) {
      this.logger.warn(`Skipping record ${recordId}: missing FreeTextNumber`);
      return false;
    }

    return true;
  }

  /**
   * Maps grouped records to D365FO request types
   */
  private mapToD365FORequests(
    invoiceGroups: Map<
      string,
      IDataEnhancedRecord<DynAccountReceivableLineDto>[]
    >,
    company: string,
  ): Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
  }> {
    const groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
    }> = [];

    for (const [_freeTextNumber, lines] of invoiceGroups.entries()) {
      if (lines.length === 0) continue;

      const header = this.mapHeaderFromLine(lines[0].data, company);
      const mappedLines = this.mapLines(lines, company);

      groupedInvoices.push({ header, lines: mappedLines });
    }

    return groupedInvoices;
  }

  /**
   * Maps the first line of an invoice group to a header request
   */
  private mapHeaderFromLine(
    firstLine: DynAccountReceivableLineDto,
    company: string,
  ): D365FOFreeTextInvoiceHeaderRequest {
    return {
      dataAreaId: company,
      InvoiceAccount: firstLine.InvoiceAccount,
      CustomerAccount: firstLine.CustomerAccount,
      DocumentDate: this.formatDate(firstLine.DocumentDate),
      InvoiceDate: this.formatDate(firstLine.InvoiceDate),
      DueDate: this.formatDate(firstLine.DueDate),
      CurrencyCode: firstLine.CurrencyCode,
      MethodOfPayment: firstLine.MethodOfPayment || null,
      TermsOfPayment: firstLine.TermsOfPayment,
      BillingClassification: firstLine.BillingClassification,
      CustomerReference: firstLine.CustomerReference,
      DefaultDimensionDisplayValue:
        firstLine.HeaderDefaultDimensionDisplayValue,
    };
  }

  /**
   * Maps invoice lines to D365FO line requests
   */
  private mapLines(
    lines: IDataEnhancedRecord<DynAccountReceivableLineDto>[],
    company: string,
  ): D365FOFreeTextInvoiceLineRequest[] {
    return lines.map((lineRecord) => {
      const line = lineRecord.data;
      return {
        dataAreaId: company,
        LineNumber: line.LineNumber || 0,
        ParentRecId: 0, // Will be set in queue processor after header is created
        BillingCode: line.BillingCode,
        Description: line.Description,
        MainAccountDisplayValue: line.LedgerDimensionDisplayValue,
        CurrencyCode: line.CurrencyCode,
        UnitPrice: line.UnitPrice,
        DefaultDimensionDisplayValue: line.DefaultDimensionDisplayValue,
      };
    });
  }

  /**
   * Validates that all invoices have required header fields
   */
  private validateInvoices(
    groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
    }>,
  ): void {
    for (const invoice of groupedInvoices) {
      if (!this.isHeaderValid(invoice.header)) {
        throw new Error(
          `Invalid invoice data: missing required header fields for invoice: ${JSON.stringify(invoice.header, null, 2)}`,
        );
      }
    }
  }

  /**
   * Checks if a header has all required fields
   */
  private isHeaderValid(header: D365FOFreeTextInvoiceHeaderRequest): boolean {
    return !!(
      header.InvoiceAccount &&
      header.CustomerAccount &&
      header.DocumentDate &&
      header.InvoiceDate
    );
  }

  /**
   * Prepares batch for posting by updating status and clearing errors
   */
  private async prepareBatchForPosting(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Processing,
      ),
      this.dataBatchService.clearDfoPostingErrorsAsync(batchId),
    ]);
  }

  /**
   * Enqueues the posting job and returns the result
   */
  private async enqueuePostingJob(
    batchId: string,
    company: string,
    groupedInvoices: Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
    }>,
  ): Promise<PostARBatchToDFOResult> {
    const job = await this.queueService.addJob(
      QUEUES.DFO,
      'post-ar-batch-to-dfo',
      {
        batchId,
        company,
        groupedInvoices,
      },
    );

    this.logger.log(
      `Enqueued job ${job.id} for batch ${batchId} with ${groupedInvoices.length} invoices`,
    );

    return {
      jobId: job.id!,
      message: `Batch ${batchId} queued for posting to D365FO. Job ID: ${job.id}`,
    };
  }

  /**
   * Converts MongoDB cursor to async iterable
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataEnhancedRecord> {
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          dimensionModel: doc.dimensionModel,
          sourceIds: doc.sourceIds || [],
          data: doc.data,
          dataModelType: doc.dataModelType,
        };
      }
    } finally {
      // Ensure cursor is closed
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {
          // Ignore errors on close
        });
      }
    }
  }

  /**
   * Format date to ISO string
   */
  private formatDate(date?: Date | string): string {
    if (!date) {
      throw new Error('Date is required');
    }
    if (date instanceof Date) {
      return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
    if (typeof date === 'string') {
      // Try to parse and format
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date format: ${date}`);
      }
      return parsed.toISOString().split('T')[0];
    }
    throw new Error(`Invalid date type: ${typeof date}`);
  }
}
