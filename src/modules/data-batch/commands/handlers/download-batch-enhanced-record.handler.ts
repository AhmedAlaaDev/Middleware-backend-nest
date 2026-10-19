import { Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import {
  DownloadBatchEnhancedRecordCommand,
  DownloadBatchEnhancedRecordResult,
} from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

interface FinanceCustomerPaymentJournalLine {
  JournalBatchNumber?: string;
  LineNumber?: number | string;
  Voucher?: string;
}

interface ShiplinkFinanceIdentifiers {
  actualBatchByPlannedBatch: ReadonlyMap<string, string>;
  financeLineByBatchAndLine: ReadonlyMap<
    string,
    FinanceCustomerPaymentJournalLine
  >;
}

const FINANCE_BACKED_CASH_IN_TYPES = new Set<EntryProcessorTypes>([
  EntryProcessorTypes.CashInFreight,
  EntryProcessorTypes.CashInTrucking,
  EntryProcessorTypes.CashInShiplink,
  EntryProcessorTypes.CashInYard,
]);

@CommandHandler(DownloadBatchEnhancedRecordCommand)
export class DownloadBatchEnhancedRecordHandler implements ICommandHandler<
  DownloadBatchEnhancedRecordCommand,
  DownloadBatchEnhancedRecordResult
> {
  private readonly logger = new Logger(DownloadBatchEnhancedRecordHandler.name);

  constructor(
    private readonly batchService: DataBatchService,
    private readonly excelService: ExcelService,
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  public async execute(
    command: DownloadBatchEnhancedRecordCommand,
  ): Promise<DownloadBatchEnhancedRecordResult> {
    const { batchId } = command;

    this.logger.log(`Downloading enhanced records for batch ${batchId}`);

    const batch = await this.batchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Data batch ${batchId} was not found`);
    }

    const cursor = await this.batchService.getEnhancedRecordsStream(batchId);

    // Convert cursor to async iterable and process records
    const recordsStream = this.cursorToAsyncIterable(cursor);

    // First pass: detect if headers exist and collect unique headers
    let hasHeader = false;
    let hasSettled = false;
    const uniqueHeaderKeys = new Set<string>();
    const headerMap = new Map<string, Record<string, unknown>>();
    const plannedJournalBatches = new Set<string>();
    let recordCount = 0;

    // Process records to detect header/settled and collect unique headers
    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data;
      const plannedBatchNumber = this.asText(data.JournalBatchNumber);
      if (plannedBatchNumber) plannedJournalBatches.add(plannedBatchNumber);
      if (data && typeof data === 'object' && 'header' in data && data.header) {
        hasHeader = true;
        const header = data.header as Record<string, unknown>;
        const headerKey = JSON.stringify(header);
        if (!uniqueHeaderKeys.has(headerKey)) {
          uniqueHeaderKeys.add(headerKey);
          headerMap.set(headerKey, header);
        }
      }
      if (
        data &&
        typeof data === 'object' &&
        'settled' in data &&
        data.settled
      ) {
        hasSettled = true;
      }
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Fetched ${recordCount} enhanced record(s) for batch ${batchId}`,
    );

    const financeIdentifiers = await this.loadCashInFinanceIdentifiers(
      batch.entryProcessorType,
      batch.company,
      batch.dfoIds ?? [],
      [...plannedJournalBatches],
      batch.dfoJournalMappings ?? [],
    );

    if (!hasHeader && !hasSettled) {
      this.logger.log(
        'No headers/settled detected → generating single Excel file.',
      );
      // Stream all records to single Excel file
      const cursor2 = await this.batchService.getEnhancedRecordsStream(batchId);
      const recordsStream2 = this.cursorToAsyncIterable(cursor2);
      const dataStream = this.extractDataStream(
        recordsStream2,
        {
          removeHeader: false,
          removeSettled: false,
        },
        financeIdentifiers,
      );
      const excelPath = await this.excelService.writeObjectsToTempFileStream(
        dataStream,
        `batch-${batchId}-lines`,
      );
      this.logger.log('Excel file generated successfully.');
      return { filePath: excelPath, isZip: false };
    }

    this.logger.log(
      `Nested objects detected (header=${hasHeader}, settled=${hasSettled}) → splitting…`,
    );

    const uniqueHeaders = Array.from(headerMap.values());
    if (hasHeader) {
      this.logger.log(`Collected ${uniqueHeaderKeys.size} unique header(s)`);
    }

    this.logger.log('Generating Excel sheets…');

    // Stream headers to Excel file (if present)
    let headersPath: string | null = null;
    if (hasHeader) {
      const headersStream = this.arrayToAsyncIterable(uniqueHeaders);
      headersPath = await this.excelService.writeObjectsToTempFileStream(
        headersStream,
        `batch-${batchId}-headers`,
      );
    }

    // Stream settled to Excel file (if present)
    let settledPath: string | null = null;
    if (hasSettled) {
      const cursorSettled =
        await this.batchService.getEnhancedRecordsStream(batchId);
      const recordsStreamSettled = this.cursorToAsyncIterable(cursorSettled);
      const settledStream = this.extractNestedStream(
        recordsStreamSettled,
        'settled',
      );
      settledPath = await this.excelService.writeObjectsToTempFileStream(
        settledStream,
        `batch-${batchId}-settled`,
      );
    }

    // Stream data (without header/settled) to Excel file
    const cursor3 = await this.batchService.getEnhancedRecordsStream(batchId);
    const recordsStream3 = this.cursorToAsyncIterable(cursor3);
    const dataStream = this.extractDataStream(
      recordsStream3,
      {
        removeHeader: true,
        removeSettled: true,
      },
      financeIdentifiers,
    );
    const linesPath = await this.excelService.writeObjectsToTempFileStream(
      dataStream,
      `batch-${batchId}-lines`,
    );

    this.logger.log('Building ZIP (streaming)…');
    const files: Array<{ filePath: string; nameInZip: string }> = [];
    if (headersPath) {
      files.push({ filePath: headersPath, nameInZip: 'headers.xlsx' });
    }
    if (settledPath) {
      files.push({ filePath: settledPath, nameInZip: 'settled.xlsx' });
    }
    files.push({ filePath: linesPath, nameInZip: 'lines.xlsx' });

    const zipPath = await this.excelService.createZipFile(batchId, files);

    this.logger.log('ZIP archive created successfully.');
    return { filePath: zipPath, isZip: true };
  }

  // ------------------------------------------
  // 🔹 Private Helpers
  // ------------------------------------------

  /**
   * Converts MongoDB cursor to async iterable
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataEnhancedRecord> {
    // Mongoose cursor is already an async iterable
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          dimensionModel: doc.dimensionModel,
          sourceIds: doc.sourceIds || [],
          data: doc.data,
          dataModelType: doc.dataModelType,
          validationRunId: doc.validationRunId,
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
   * Extracts data from records, optionally removing nested properties
   */
  private async *extractDataStream(
    recordsStream: AsyncIterable<IDataEnhancedRecord>,
    opts: { removeHeader: boolean; removeSettled: boolean },
    financeIdentifiers?: ShiplinkFinanceIdentifiers,
  ): AsyncIterable<Record<string, unknown>> {
    for await (const record of recordsStream) {
      const data = record.data;
      if (!data || typeof data !== 'object') {
        yield data as any;
        continue;
      }

      const obj = data;
      if (!opts.removeHeader && !opts.removeSettled) {
        yield this.withFinanceIdentifiers(obj, financeIdentifiers);
        continue;
      }

      // Remove nested objects that we export separately
      const { header, settled, ...rest } = obj as any;

      const withoutHeader = opts.removeHeader ? rest : { header, ...rest };
      if (!opts.removeSettled) {
        yield this.withFinanceIdentifiers(
          { settled, ...withoutHeader } as Record<string, unknown>,
          financeIdentifiers,
        );
      } else {
        yield this.withFinanceIdentifiers(
          withoutHeader as Record<string, unknown>,
          financeIdentifiers,
        );
      }
    }
  }

  /**
   * Finance generates its journal number on the header POST and can assign the
   * voucher while creating its journal lines. The local processor values are
   * only planned identifiers, so the enhanced download is refreshed from D365
   * once the cash-in lines exist.
   */
  private async loadCashInFinanceIdentifiers(
    entryProcessorType: EntryProcessorTypes,
    company: string,
    actualBatches: string[],
    plannedBatches: string[],
    savedMappings: Array<{
      plannedJournalBatchNumber: string;
      financeJournalBatchNumber: string;
    }>,
  ): Promise<ShiplinkFinanceIdentifiers | undefined> {
    if (
      !FINANCE_BACKED_CASH_IN_TYPES.has(entryProcessorType) ||
      actualBatches.length === 0 ||
      plannedBatches.length === 0
    ) {
      return undefined;
    }

    const actualBatchByPlannedBatch = new Map(
      savedMappings
        .map(
          (mapping) =>
            [
              this.asText(mapping.plannedJournalBatchNumber),
              this.asText(mapping.financeJournalBatchNumber),
            ] as const,
        )
        .filter(([planned, actual]) => planned && actual),
    );
    if (actualBatchByPlannedBatch.size !== plannedBatches.length) {
      this.logger.warn(
        `Cash-in enhanced export found ${actualBatchByPlannedBatch.size}/${plannedBatches.length} saved Finance journal mapping(s).`,
      );
    }

    const financeLineByBatchAndLine = new Map<
      string,
      FinanceCustomerPaymentJournalLine
    >();
    for (const actualBatch of new Set(actualBatchByPlannedBatch.values())) {
      let endpoint = this.query.buildQuery(
        '/data/CustomerPaymentJournalLines',
        {
          crossCompany: true,
          top: 5000,
          select: ['JournalBatchNumber', 'LineNumber', 'Voucher'],
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            this.query.eq('JournalBatchNumber', actualBatch),
          ),
        },
      );
      while (endpoint) {
        const response = await this.d365.get<FinanceCustomerPaymentJournalLine>(
          endpoint,
          {
            useCache: false,
          },
        );
        for (const line of response.value ?? []) {
          const lineNumber = Number(line.LineNumber);
          if (!Number.isInteger(lineNumber) || lineNumber <= 0) continue;
          financeLineByBatchAndLine.set(
            this.financeLineKey(actualBatch, lineNumber),
            line,
          );
        }
        endpoint = this.nextLinkToEndpoint(response['@odata.nextLink']);
      }
    }

    return { actualBatchByPlannedBatch, financeLineByBatchAndLine };
  }

  private withFinanceIdentifiers(
    data: Record<string, unknown>,
    identifiers?: ShiplinkFinanceIdentifiers,
  ): Record<string, unknown> {
    if (!identifiers) return data;

    const plannedBatch = this.asText(data.JournalBatchNumber);
    const plannedVoucher = this.asText(data.Voucher);
    const plannedLineNumber = Number(data.LineNumber);
    const financeBatch =
      identifiers.actualBatchByPlannedBatch.get(plannedBatch);
    if (!financeBatch || !Number.isInteger(plannedLineNumber)) {
      return {
        ...data,
        FinanceIdentifierStatus: 'Finance batch mapping unavailable',
      };
    }

    const financeLine = identifiers.financeLineByBatchAndLine.get(
      this.financeLineKey(financeBatch, plannedLineNumber),
    );
    const financeVoucher = this.asText(financeLine?.Voucher);
    return {
      ...data,
      PlannedJournalBatchNumber: plannedBatch,
      PlannedVoucher: plannedVoucher,
      FinanceJournalBatchNumber: financeBatch,
      FinanceVoucher: financeVoucher,
      JournalBatchNumber: financeBatch,
      ...(financeLine?.LineNumber !== undefined
        ? { LineNumber: Number(financeLine.LineNumber) }
        : {}),
      ...(financeLine ? { Voucher: financeVoucher } : {}),
      FinanceIdentifierStatus: financeLine
        ? financeVoucher
          ? 'Finance batch and voucher synchronized'
          : 'Finance batch synchronized; voucher is blank in Finance'
        : 'Finance batch synchronized; journal line was not found',
    };
  }

  private financeLineKey(batch: string, lineNumber: number): string {
    return `${batch.trim().toLowerCase()}|${lineNumber}`;
  }

  private nextLinkToEndpoint(nextLink?: string): string {
    const value = this.asText(nextLink);
    if (!value) return '';
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}`;
    } catch {
      return value;
    }
  }

  private asText(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value).trim();
    }
    return '';
  }

  /**
   * Extracts a nested object stream (e.g. `settled`) from records.
   * Skips records where nested object is missing.
   */
  private async *extractNestedStream(
    recordsStream: AsyncIterable<IDataEnhancedRecord>,
    nestedKey: 'settled',
  ): AsyncIterable<Record<string, unknown>> {
    for await (const record of recordsStream) {
      const data = record.data;
      if (!data || typeof data !== 'object') continue;

      const nested = (data as any)?.[nestedKey];
      if (!nested || typeof nested !== 'object') continue;

      yield nested as Record<string, unknown>;
    }
  }

  /**
   * Converts array to async iterable
   */
  private async *arrayToAsyncIterable<T>(array: T[]): AsyncIterable<T> {
    for (const item of array) {
      await Promise.resolve(); // Satisfy async generator requirement
      yield item;
    }
  }
}
