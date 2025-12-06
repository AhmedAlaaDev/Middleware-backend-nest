import { Injectable } from '@nestjs/common';

import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import {
  IDataBatch,
  IDataBatchListFilter,
} from '@/modules/data-batch/interfaces/data-batch.interface';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
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
  constructor(
    private readonly dataBatchRepo: DataBatchRepository,
    private readonly dataBatchErrorRepo: DataBatchErrorRepository,
    private readonly dataSourceRecordRepo: DataSourceRecordRepository,
    private readonly dataEnhancedRecordRepo: DataEnhancedRecordRepository,
  ) {}

  /**
   * Create a new batch with source and enhanced records
   */
  public async createAsync(
    entryProcessorType: EntryProcessorTypes,
    entryProcessorName: string,
    companyId: string,
    description: string,
    rawData: RawDataModel[],
    dynData: DynDataModel[],
    billingClassification?: string,
  ): Promise<IDataBatch> {
    const successCount = dynData.filter((d) => d.errorCount === 0).length;
    const errorCount = dynData.filter((d) => d.errorCount > 0).length;

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

    // Bulk insert source records
    if (rawData.length > 0) {
      const sourceRecords = rawData.map((record) => ({
        batchId: dataBatch.id,
        data: record,
      }));
      await this.dataSourceRecordRepo.insertMany(sourceRecords);
    }

    // Bulk insert enhanced records
    if (dynData.length > 0) {
      const enhancedRecords = dynData.map((record) => ({
        batchId: dataBatch.id,
        dimensionModel: record.dimensionModel,
        sourceIds: record.sourceIds || [],
        data: record,
        dataModelType: this.getDataModelType(record),
      }));
      await this.dataEnhancedRecordRepo.insertMany(enhancedRecords);
    }

    // Insert errors if any
    const errorRecords = dynData.filter((d) => d.errorCount > 0);
    if (errorRecords.length > 0) {
      const batchErrors = errorRecords.map((record) => ({
        batchId: dataBatch.id,
        sourceRecordIds: record.sourceIds || [],
        errorMessages: record.getErrors(),
        accountDimensionsModel: record.dimensionModel,
        enhancedRecordIds: [record.lineNumber?.toString() || ''],
      }));
      await this.dataBatchErrorRepo.insertMany(batchErrors);
    }

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
   * Get enhanced records for a batch
   */
  public async getEnhancedRecordsAsync(
    batchId: string,
  ): Promise<IDataEnhancedRecord[]> {
    return this.dataEnhancedRecordRepo.getList(batchId);
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
   * get data batch errors
   */
  public async getErrorsAsync(batchId: string): Promise<IDataBatchError[]> {
    return this.dataBatchErrorRepo.getList({ batchId });
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
