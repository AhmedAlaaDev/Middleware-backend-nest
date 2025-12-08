import { Injectable, Logger } from '@nestjs/common';

import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import {
  ICreateDataBatchError,
  IDataBatchError,
} from '@/modules/data-batch/interfaces/data-batch-error.interface';
import {
  IDataBatch,
  IDataBatchListFilter,
} from '@/modules/data-batch/interfaces/data-batch.interface';
import {
  ICreateDataEnhancedRecord,
  IDataEnhancedRecord,
} from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import {
  ICreateDataSourceRecord,
  IDataSourceRecord,
} from '@/modules/data-batch/interfaces/data-source-record.interface';
import {
  DataBatchErrorRepository,
  DataBatchRepository,
  DataEnhancedRecordRepository,
  DataSourceRecordRepository,
} from '@/modules/data-batch/repositories/interfaces';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';

@Injectable()
export class DataBatchService {
  private readonly logger = new Logger(DataBatchService.name);
  constructor(
    private readonly dataBatchRepo: DataBatchRepository,
    private readonly dataBatchErrorRepo: DataBatchErrorRepository,
    private readonly dataSourceRecordRepo: DataSourceRecordRepository,
    private readonly dataEnhancedRecordRepo: DataEnhancedRecordRepository,
  ) {}

  /**
   * Create a new batch with source and enhanced records
   * @template TRawData - Type of raw/source data records
   * @template TEnhancedData - Type of enhanced/dynamic data records
   */
  public async createAsync<
    TRawData extends RawDataModel = RawDataModel,
    TEnhancedData extends DynDataModel = DynDataModel,
  >(
    entryProcessorType: EntryProcessorTypes,
    entryProcessorName: string,
    companyId: string,
    description: string,
    rawData: TRawData[],
    dynData: TEnhancedData[],
    billingClassification?: string,
  ): Promise<IDataBatch> {
    this.logger.log(
      `Creating data batch: type=${entryProcessorType} name=${entryProcessorName} company=${companyId} raw=${rawData.length} dyn=${dynData.length}`,
    );
    const successCount = dynData.filter((d) => d.ErrorCount === 0).length;
    const errorCount = dynData.filter((d) => d.ErrorCount > 0).length;
    this.logger.debug(
      `Counts computed: success=${successCount} error=${errorCount}`,
    );

    // Create batch
    const dataBatch = await this.dataBatchRepo.create({
      company: companyId,
      entryProcessorType,
      entryProcessorName,
      description,
      successCount,
      errorCount,
      totalFormattedCount: dynData.length,
      totalUploadedCount: rawData.length,
      status: DataBatchStatus.Pending,
      billingCodeId: billingClassification,
    });
    this.logger.log(`Batch created: id=${dataBatch.id}`);

    // Bulk insert source records
    if (rawData.length > 0) {
      const sourceRecords: ICreateDataSourceRecord<TRawData>[] = rawData.map(
        (record) => ({
          batchId: dataBatch.id,
          data: record,
        }),
      );
      // Convert to storage format for repository
      const storageRecords = sourceRecords.map((record) => ({
        batchId: record.batchId,
        data: record.data as unknown as Record<string, unknown>,
      }));
      await this.dataSourceRecordRepo.insertMany(storageRecords);
      this.logger.debug(
        `Inserted source records: count=${sourceRecords.length}`,
      );
    }

    // Bulk insert enhanced records
    if (dynData.length > 0) {
      const enhancedRecords: ICreateDataEnhancedRecord<TEnhancedData>[] =
        dynData.map((record) => ({
          batchId: dataBatch.id,
          dimensionModel: record.dimensionModel
            ? (Object.assign({}, record.dimensionModel) as unknown as Record<
                string,
                unknown
              >)
            : undefined,
          sourceIds: record.sourceIds || [],
          data: record,
          dataModelType: this.getDataModelType(record),
        }));
      // Convert to storage format for repository
      const storageRecords = enhancedRecords.map((record) => ({
        batchId: record.batchId,
        dimensionModel: record.dimensionModel,
        sourceIds: record.sourceIds,
        data: record.data as unknown as Record<string, unknown>,
        dataModelType: record.dataModelType,
      }));
      await this.dataEnhancedRecordRepo.insertMany(storageRecords);
      this.logger.debug(
        `Inserted enhanced records: count=${enhancedRecords.length}`,
      );
    }

    // Insert errors if any
    const errorRecords = dynData.filter((d) => d.ErrorCount > 0);
    if (errorRecords.length > 0) {
      const batchErrors: ICreateDataBatchError<TEnhancedData>[] =
        errorRecords.map((record) => ({
          batchId: dataBatch.id,
          sourceRecordIds: record.sourceIds || [],
          errorMessages: record.getErrors(),
          accountDimensionsModel: record.dimensionModel
            ? (Object.assign({}, record.dimensionModel) as unknown as Record<
                string,
                any
              >)
            : undefined,
          enhancedRecordIds: [record.LineNumber?.toString() || ''],
          enhancedData: record,
        }));
      // Convert to storage format for repository
      const storageErrors = batchErrors.map((error) => ({
        batchId: error.batchId,
        sourceRecordIds: error.sourceRecordIds,
        errorMessages: error.errorMessages,
        accountDimensionsModel: error.accountDimensionsModel,
        enhancedRecordIds: error.enhancedRecordIds,
        enhancedData: error.enhancedData
          ? (error.enhancedData as unknown as Record<string, unknown>)
          : undefined,
      }));
      await this.dataBatchErrorRepo.insertMany(storageErrors);
      this.logger.debug(`Inserted batch errors: count=${batchErrors.length}`);
    }

    this.logger.log(
      `Data batch finalized: id=${dataBatch.id} raw=${rawData.length} dyn=${dynData.length} errors=${errorRecords.length}`,
    );
    return dataBatch;
  }

  /**
   * Delete batch and all related records
   */
  public async deleteAsync(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchRepo.deleteOne(batchId),
      this.dataSourceRecordRepo.deleteMany(batchId),
      this.dataEnhancedRecordRepo.deleteMany(batchId),
      this.dataBatchErrorRepo.deleteMany(batchId),
    ]);
  }

  /**
   * Get batch by ID
   */
  public async getByIdAsync(batchId: string): Promise<IDataBatch | null> {
    return this.dataBatchRepo.findById(batchId);
  }

  /**
   * Get source records for a batch
   * @template TRawData - Type of raw/source data records
   */
  public async getSourceRecordsAsync<TRawData = Record<string, unknown>>(
    batchId: string,
  ): Promise<IDataSourceRecord<TRawData>[]> {
    const records = await this.dataSourceRecordRepo.getList(batchId);
    return records as IDataSourceRecord<TRawData>[];
  }

  /**
   * Get enhanced records for a batch
   * @template TEnhancedData - Type of enhanced data records
   */
  public async getEnhancedRecordsAsync<TEnhancedData = Record<string, unknown>>(
    batchId: string,
  ): Promise<IDataEnhancedRecord<TEnhancedData>[]> {
    const records = await this.dataEnhancedRecordRepo.getList(batchId);
    return records as IDataEnhancedRecord<TEnhancedData>[];
  }

  /**
   * Update batch status
   */
  public async updateStatusAsync(
    batchId: string,
    status: DataBatchStatus,
  ): Promise<void> {
    await this.dataBatchRepo.updateOne(batchId, { status });
  }

  /**
   * Get data batch errors
   * @template TEnhancedData - Type of enhanced data in errors
   */
  public async getErrorsAsync<TEnhancedData = Record<string, unknown>>(
    batchId: string,
  ): Promise<IDataBatchError<TEnhancedData>[]> {
    const errors = await this.dataBatchErrorRepo.getList({ batchId });
    return errors as IDataBatchError<TEnhancedData>[];
  }

  public async getDataBatchListAsync(
    filter: IDataBatchListFilter,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IDataBatch[]; total: number }> {
    const items = await this.dataBatchRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.dataBatchRepo.getCount(filter);
    return { items, total };
  }

  public async getBatchErrorListAsync(
    batchId: string,
    skipCount?: number,
    maxCount?: number,
  ): Promise<{ items: IDataBatchError[]; total: number }> {
    const items = await this.dataBatchErrorRepo.getList(
      { batchId },
      {
        skipCount,
        maxCount,
      },
    );
    const total = await this.dataBatchErrorRepo.getCount({ batchId });
    return { items, total };
  }

  private getDataModelType(record: DynDataModel): string {
    // Determine model type based on record structure
    if ('customerAccount' in record) {
      return 'DynAccountReceivableLineDto';
    }
    if ('journalBatchNumber' in record) {
      return 'DynLedgerClosingJournalEntryDto';
    }
    if ('journalName' in record && 'vendorAccount' in record) {
      return 'DynVendorInvoiceJournalDto';
    }
    return 'DynLedgerVendorJournalEntryDto';
  }
}
