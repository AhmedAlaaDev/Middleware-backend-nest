import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DataBatch,
  DataBatchStatus,
  EntryProcessorTypes,
} from '../schemas/data-batch.schema';
import {
  DataSourceRecord,
} from '../schemas/data-source-record.schema';
import {
  DataEnhancedRecord,
} from '../schemas/data-enhanced-record.schema';
import {
  DataBatchError,
} from '../schemas/data-batch-error.schema';

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  lineNumber?: number;
  errorCount: number;
  dimensionModel?: any;
  sourceIds: string[];
  getErrors(): string[];
  [key: string]: any;
}

@Injectable()
export class DataBatchService {
  private readonly logger = new Logger(DataBatchService.name);

  constructor(
    @InjectModel(DataBatch.name)
    private readonly dataBatchModel: Model<DataBatch>,
    @InjectModel(DataSourceRecord.name)
    private readonly sourceRecordModel: Model<DataSourceRecord>,
    @InjectModel(DataEnhancedRecord.name)
    private readonly enhancedRecordModel: Model<DataEnhancedRecord>,
    @InjectModel(DataBatchError.name)
    private readonly batchErrorModel: Model<DataBatchError>,
  ) {}

  /**
   * Create a new batch with source and enhanced records
   */
  async createAsync(
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
    const dataBatch = new this.dataBatchModel({
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
      await this.sourceRecordModel.insertMany(sourceRecords);
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
      await this.enhancedRecordModel.insertMany(enhancedRecords);
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
      await this.batchErrorModel.insertMany(batchErrors);
    }

    this.logger.log(
      `Created batch ${savedBatch._id} with ${rawData.length} source records and ${dynData.length} enhanced records`,
    );

    return savedBatch;
  }

  /**
   * Delete batch and all related records
   */
  async deleteAsync(batchId: string): Promise<void> {
    await Promise.all([
      this.dataBatchModel.deleteOne({ _id: batchId }),
      this.sourceRecordModel.deleteMany({ batchId }),
      this.enhancedRecordModel.deleteMany({ batchId }),
      this.batchErrorModel.deleteMany({ batchId }),
    ]);

    this.logger.log(`Deleted batch ${batchId} and all related records`);
  }

  /**
   * Get batch by ID
   */
  async getByIdAsync(batchId: string): Promise<DataBatch | null> {
    return this.dataBatchModel.findById(batchId).exec();
  }

  /**
   * Get enhanced records for a batch
   */
  async getEnhancedRecordsAsync(batchId: string): Promise<DataEnhancedRecord[]> {
    return this.enhancedRecordModel.find({ batchId }).exec();
  }

  /**
   * Update batch status
   */
  async updateStatusAsync(
    batchId: string,
    status: DataBatchStatus,
  ): Promise<void> {
    await this.dataBatchModel
      .updateOne({ _id: batchId }, { status })
      .exec();
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

