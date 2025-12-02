import { Injectable, Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';
import {
  DataBatch,
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/db/schemas/data-batch.schema';
import { DataEnhancedRecord } from '@/modules/db/schemas/data-enhanced-record.schema';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';

@Injectable()
export class DataBatchService {
  private readonly logger = new Logger(DataBatchService.name);

  constructor(private readonly db: DBService) {}

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
  ): Promise<DataBatch> {
    const successCount = dynData.filter((d) => d.errorCount === 0).length;
    const errorCount = dynData.filter((d) => d.errorCount > 0).length;

    // Create batch
    const dataBatch = new this.db.dataBatchModel({
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

    const savedBatch = await dataBatch.save();

    // Bulk insert source records
    if (rawData.length > 0) {
      const sourceRecords = rawData.map((record) => ({
        batchId: savedBatch._id.toString(),
        data: record,
      }));
      await this.db.dataSourceRecordModel.insertMany(sourceRecords);
    }

    // Bulk insert enhanced records
    if (dynData.length > 0) {
      const enhancedRecords = dynData.map((record) => ({
        batchId: savedBatch._id.toString(),
        dimensionModel: record.dimensionModel,
        sourceIds: record.sourceIds || [],
        data: record,
        dataModelType: this.getDataModelType(record),
      }));
      await this.db.dataEnhancedRecordModel.insertMany(enhancedRecords);
    }

    // Insert errors if any
    const errorRecords = dynData.filter((d) => d.errorCount > 0);
    if (errorRecords.length > 0) {
      const batchErrors = errorRecords.map((record) => ({
        batchId: savedBatch._id.toString(),
        sourceRecordIds: record.sourceIds || [],
        errorMessages: record.getErrors(),
        accountDimensionsModel: record.dimensionModel,
        enhancedRecordIds: [record.lineNumber?.toString() || ''],
      }));
      await this.db.dataBatchErrorModel.insertMany(batchErrors);
    }

    this.logger.log(
      `Created batch ${savedBatch._id.toString()} with ${rawData.length} source records and ${dynData.length} enhanced records`,
    );

    return savedBatch;
  }

  /**
   * Delete batch and all related records
   */
  public async deleteAsync(batchId: string): Promise<void> {
    await Promise.all([
      this.db.dataBatchModel.deleteOne({ _id: batchId }),
      this.db.dataSourceRecordModel.deleteMany({ batchId }),
      this.db.dataEnhancedRecordModel.deleteMany({ batchId }),
      this.db.dataBatchErrorModel.deleteMany({ batchId }),
    ]);

    this.logger.log(`Deleted batch ${batchId} and all related records`);
  }

  /**
   * Get batch by ID
   */
  public async getByIdAsync(batchId: string): Promise<DataBatch | null> {
    return this.db.dataBatchModel.findById(batchId).exec();
  }

  /**
   * Get enhanced records for a batch
   */
  public async getEnhancedRecordsAsync(
    batchId: string,
  ): Promise<DataEnhancedRecord[]> {
    return this.db.dataEnhancedRecordModel.find({ batchId }).exec();
  }

  /**
   * Update batch status
   */
  public async updateStatusAsync(
    batchId: string,
    status: DataBatchStatus,
  ): Promise<void> {
    await this.db.dataBatchModel.updateOne({ _id: batchId }, { status }).exec();
  }

  /**
   * get data batch errors
   */
  public async getErrorsAsync(batchId: string): Promise<DataBatchError[]> {
    return this.db.dataBatchErrorModel.find({ batchId }).lean().exec();
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
