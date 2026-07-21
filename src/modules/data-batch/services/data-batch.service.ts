import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import {
  ICreateDataBatchError,
  IDataBatchError,
} from '@/modules/data-batch/interfaces/data-batch-error.interface';
import {
  BatchReprocessStatus,
  CustomerCreationStatus,
  IDataBatchMissingMasterData,
  IMissingMasterDataItem,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
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
  DataBatchMissingMasterDataRepository,
} from '@/modules/data-batch/repositories/interfaces';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { UpdateSettingValueCommand } from '@/modules/settings/commands/update-setting-value.command';

@Injectable()
export class DataBatchService {
  private readonly logger = new Logger(DataBatchService.name);
  constructor(
    private readonly dataBatchRepo: DataBatchRepository,
    private readonly dataBatchErrorRepo: DataBatchErrorRepository,
    private readonly dataSourceRecordRepo: DataSourceRecordRepository,
    private readonly dataEnhancedRecordRepo: DataEnhancedRecordRepository,
    private readonly missingMasterDataRepo: DataBatchMissingMasterDataRepository,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly commandBus: CommandBus,
    private readonly traceContext: TraceContextService,
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
    voucherNumberSettingLogicalName?: string,
    options?: {
      withholdingRemovedCount?: number;
      withholdingRemovedAmount?: number;
    }
  ): Promise<IDataBatch> {
    this.logger.log(
      `Creating data batch: type=${entryProcessorType} name=${entryProcessorName} company=${companyId} raw=${rawData.length} dyn=${dynData.length}`,
    );
    const successCount = dynData.filter((d) => d.ErrorCount === 0).length;
    const errorCount = dynData.filter((d) => d.ErrorCount > 0).length;
    const expectedGroupCount = this.calculateExpectedGroupCount(dynData);
    const validationRunId = randomUUID();
    const actor = this.traceContext.get();
    this.logger.debug(
      `Counts computed: success=${successCount} error=${errorCount}`,
    );

    const sourceColumnHeaders = this.collectSourceColumnHeaders(rawData);

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
      status: DataBatchStatus.PendingPosting,
      billingCodeId: billingClassification,
      expectedGroupCount,
      activeValidationRunId: validationRunId,
      createdByUserId: actor?.userId,
      createdByName: actor?.userName,
      createdByEmail: actor?.userEmail,
      reprocessCount: 0,
      withholdingRemovedCount: options?.withholdingRemovedCount ?? 0,
      withholdingRemovedAmount: options?.withholdingRemovedAmount ?? 0,
      sourceColumnHeaders:
        sourceColumnHeaders.length > 0 ? sourceColumnHeaders : undefined,
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
          dimensionModel: record.DimensionModel
            ? (Object.assign({}, record.DimensionModel) as unknown as Record<
                string,
                unknown
              >)
            : undefined,
          sourceIds: record.SourceIds || [],
          data: record,
          dataModelType: this.getDataModelType(record),
          validationRunId,
        }));
      // Convert to storage format for repository
      const storageRecords = enhancedRecords.map((record) => ({
        batchId: record.batchId,
        dimensionModel: record.dimensionModel,
        sourceIds: record.sourceIds,
        data: record.data as unknown as Record<string, unknown>,
        dataModelType: record.dataModelType,
        validationRunId: record.validationRunId,
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
          sourceRecordIds: record.SourceIds || [],
          errorMessages: record.GetErrors(),
          accountDimensionsModel: record.DimensionModel
            ? (Object.assign({}, record.DimensionModel) as unknown as Record<
                string,
                any
              >)
            : undefined,
          enhancedRecordIds: [record.LineNumber?.toString() || ''],
          enhancedData: record,
          validationRunId,
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
        validationRunId: error.validationRunId,
      }));
      await this.dataBatchErrorRepo.insertMany(storageErrors);
      this.logger.debug(`Inserted batch errors: count=${batchErrors.length}`);
    }

    this.logger.log(
      `Data batch finalized: id=${dataBatch.id} raw=${rawData.length} dyn=${dynData.length} errors=${errorRecords.length}`,
    );

    // Process and store missing master data if any
    const missingMasterDataItems: IMissingMasterDataItem[] = [];

    for (const record of dynData) {
      for (const item of record.GetMissingMasterData()) {
        missingMasterDataItems.push(item);
      }
    }

    if (missingMasterDataItems.length > 0) {
      const grouped = new Map<
        string,
        {
          type: MissingMasterDataType;
          missingField: 'CustomerAccount' | 'TaxExemptNumber';
          missingValue: string;
          formDefaults: Record<string, unknown>;
          affectedCount: number;
        }
      >();

      for (const item of missingMasterDataItems) {
        const key = `${item.type}|${item.missingField}|${item.missingValue}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.affectedCount++;
        } else {
          grouped.set(key, {
            ...item,
            affectedCount: 1,
          });
        }
      }

      for (const groupedItem of grouped.values()) {
        await this.missingMasterDataRepo.upsert(
          dataBatch.id,
          groupedItem.type,
          groupedItem.missingField,
          groupedItem.missingValue,
          {
            company: companyId,
            entryProcessorType,
            creationStatus: 'missing',
            reprocessStatus: 'not_started',
            affectedCount: groupedItem.affectedCount,
            formDefaults: groupedItem.formDefaults,
            readonlyFormFields: [groupedItem.missingField],
            reprocessAttempts: 0,
          },
        );
      }
      this.logger.debug(
        `Upserted missing master data records: count=${grouped.size}`,
      );
    }

    // Update settings asynchronously (batch number always, voucher number if provided)
    this.updateBatchSettingsAsync(
      dynData,
      voucherNumberSettingLogicalName,
    ).catch((error) => {
      this.logger.error(
        `Failed to update batch settings: ${error.message}`,
        error.stack,
      );
    });

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
      this.missingMasterDataRepo.deleteMany(batchId),
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
   * Get source records stream for a batch (memory-efficient)
   */
  public getSourceRecordsStream(batchId: string): any {
    return this.dataSourceRecordRepo.getListStream(batchId);
  }

  /**
   * Get enhanced records for a batch
   * @template TEnhancedData - Type of enhanced data records
   */
  public async getEnhancedRecordsAsync<TEnhancedData = Record<string, unknown>>(
    batchId: string,
  ): Promise<IDataEnhancedRecord<TEnhancedData>[]> {
    const batch = await this.requireBatch(batchId);
    const records = await this.dataEnhancedRecordRepo.getList(
      batchId,
      batch.activeValidationRunId,
    );
    return records as IDataEnhancedRecord<TEnhancedData>[];
  }

  /**
   * Get enhanced records stream for a batch (memory-efficient)
   */
  public async getEnhancedRecordsStream(batchId: string): Promise<any> {
    const batch = await this.requireBatch(batchId);
    return this.dataEnhancedRecordRepo.getListStream(
      batchId,
      batch.activeValidationRunId,
    );
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

  public recordReprocessQueued(
    batchId: string,
    audit: {
      at: Date;
      userId: string;
      userName: string;
      userEmail: string;
      jobId: string;
    },
  ): Promise<void> {
    return this.dataBatchRepo.recordReprocessQueued(batchId, audit);
  }

  public updateReprocessStatus(
    batchId: string,
    status: 'active' | 'completed' | 'failed',
    error?: string,
  ): Promise<void> {
    return this.dataBatchRepo.updateOne(batchId, {
      lastReprocessStatus: status,
      lastReprocessError: error,
    });
  }

  /**
   * Update batch with DFO-created header IDs
   */
  public async updateDfoIdsAsync(
    batchId: string,
    dfoIds: string[],
  ): Promise<void> {
    await this.dataBatchRepo.updateOne(batchId, { dfoIds });
  }

  /**
   * Update batch with DFO posting error messages
   */
  public async updateDfoPostingErrorsAsync(
    batchId: string,
    errors: string[],
  ): Promise<void> {
    await this.dataBatchRepo.updateOne(batchId, { dfoPostingErrors: errors });
  }

  /**
   * Clear DFO posting errors (useful when retrying)
   */
  public async clearDfoPostingErrorsAsync(batchId: string): Promise<void> {
    await this.dataBatchRepo.updateOne(batchId, { dfoPostingErrors: [] });
  }

  /**
   * Get data batch errors
   * @template TEnhancedData - Type of enhanced data in errors
   */
  public async getErrorsAsync<TEnhancedData = Record<string, unknown>>(
    batchId: string,
  ): Promise<IDataBatchError<TEnhancedData>[]> {
    const batch = await this.requireBatch(batchId);
    const errors = await this.dataBatchErrorRepo.getList({
      batchId,
      validationRunId: batch.activeValidationRunId,
    });
    return errors as IDataBatchError<TEnhancedData>[];
  }

  /**
   * Get data batch errors stream (memory-efficient)
   */
  public async getErrorsStream(batchId: string): Promise<any> {
    const batch = await this.requireBatch(batchId);
    return this.dataBatchErrorRepo.getListStream({
      batchId,
      validationRunId: batch.activeValidationRunId,
    });
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
    const batch = await this.requireBatch(batchId);
    const filter = {
      batchId,
      validationRunId: batch.activeValidationRunId,
    };
    const items = await this.dataBatchErrorRepo.getList(filter, {
      skipCount,
      maxCount,
    });
    const total = await this.dataBatchErrorRepo.getCount(filter);
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

  private calculateExpectedGroupCount(dynData: DynDataModel[]): number {
    const groupKeys = new Set<string>();
    for (const record of dynData) {
      const groupKey = this.getExpectedGroupKey(record);
      if (groupKey) {
        groupKeys.add(groupKey);
      }
    }

    return groupKeys.size;
  }

  private getExpectedGroupKey(record: DynDataModel): string | undefined {
    const data = record as Record<string, unknown>;
    const candidates = [
      data.FreeTextNumber,
      data.freeTextNumber,
      data.JournalBatchNumber,
      data.journalBatchNumber,
      data.JOURNALBATCHNUMBER,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  /**
   * Update batch settings (batch number always, voucher number if setting name provided) asynchronously
   * Extracts the latest values from enriched data and updates settings without awaiting
   */
  private updateBatchSettingsAsync(
    dynData: DynDataModel[],
    voucherNumberSettingLogicalName?: string,
  ): Promise<void> {
    if (dynData.length === 0) {
      return Promise.resolve();
    }

    let latestBatchNumber: number | null = null;
    let latestVoucherNumber: number | null = null;

    // Extract batch numbers and voucher numbers from enriched data
    for (const record of dynData) {
      // Extract batch number from JOURNALBATCHNUMBER field
      if (record.JOURNALBATCHNUMBER) {
        const batchNum = this.parseBatchNumber(
          record.JOURNALBATCHNUMBER as string,
        );
        if (batchNum !== null) {
          if (latestBatchNumber === null || batchNum > latestBatchNumber) {
            latestBatchNumber = batchNum;
          }
        }
      }

      // Extract voucher number from VOUCHER field (only if setting name is provided)
      if (
        voucherNumberSettingLogicalName &&
        record.VOUCHER !== undefined &&
        record.VOUCHER !== null
      ) {
        const voucherNum = this.parseVoucherNumber(record.VOUCHER);
        if (voucherNum !== null) {
          if (
            latestVoucherNumber === null ||
            voucherNum > latestVoucherNumber
          ) {
            latestVoucherNumber = voucherNum;
          }
        }
      }
    }

    // Update batch number setting asynchronously (fire and forget) - always update
    if (latestBatchNumber !== null) {
      this.commandBus
        .execute(
          new UpdateSettingValueCommand(
            'last.ledger.batch.number',
            String(latestBatchNumber),
          ),
        )
        .catch((error) => {
          this.logger.error(
            `Failed to update batch number setting: ${error.message}`,
            error.stack,
          );
        });
    }

    // Update voucher number setting asynchronously (fire and forget) - only if setting name provided
    if (voucherNumberSettingLogicalName && latestVoucherNumber !== null) {
      this.commandBus
        .execute(
          new UpdateSettingValueCommand(
            voucherNumberSettingLogicalName,
            String(latestVoucherNumber),
          ),
        )
        .catch((error) => {
          this.logger.error(
            `Failed to update voucher number setting: ${error.message}`,
            error.stack,
          );
        });
    }

    return Promise.resolve();
  }

  /**
   * Parse batch number from formatted string (e.g., "Mesco-000000123" -> 123)
   */
  private parseBatchNumber(formattedBatch: string): number | null {
    try {
      // Format is: "Mesco-000000123" or "prefix-000000123"
      const parts = formattedBatch.split('-');
      if (parts.length < 2) {
        return null;
      }
      const numberPart = parts[parts.length - 1];
      const parsed = parseInt(numberPart, 10);
      return isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  }

  /**
   * Parse voucher number from formatted string or number
   * Format can be: "prefix-000000123" or just a number
   */
  private parseVoucherNumber(voucher: number | string): number | null {
    try {
      if (typeof voucher === 'number') {
        return voucher;
      }
      if (typeof voucher === 'string') {
        // Format is: "prefix-000000123"
        const parts = voucher.split('-');
        if (parts.length < 2) {
          // Try parsing as direct number
          const parsed = parseInt(voucher, 10);
          return isNaN(parsed) ? null : parsed;
        }
        const numberPart = parts[parts.length - 1];
        const parsed = parseInt(numberPart, 10);
        return isNaN(parsed) ? null : parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get missing master data list for a batch
   */
  public getMissingMasterDataAsync(
    batchId: string,
    filter?: {
      type?: MissingMasterDataType;
      creationStatus?: CustomerCreationStatus;
    },
  ): Promise<IDataBatchMissingMasterData[]> {
    return this.missingMasterDataRepo.getList(batchId, filter);
  }

  /**
   * Reprocess a data batch by re-running formatting, enrichment, and validation
   */
  public async reprocessBatchAsync(
    batchId: string,
    missingDataId?: string,
  ): Promise<void> {
    this.logger.log(`Reprocessing batch: id=${batchId}`);
    const batch = await this.dataBatchRepo.claimForRevalidation(batchId);
    if (!batch) {
      const existingBatch = await this.dataBatchRepo.findById(batchId);
      if (!existingBatch) {
        throw new NotFoundException(`Batch with ID ${batchId} not found`);
      }
      throw new ConflictException(
        `Batch cannot be reprocessed while status is ${existingBatch.status}`,
      );
    }

    const previousValidationRunId = batch.activeValidationRunId;
    let replacementValidationRunId: string | undefined;
    let missingRecord: IDataBatchMissingMasterData | null = null;

    try {
      if (missingDataId) {
        missingRecord =
          await this.missingMasterDataRepo.findById(missingDataId);
        if (!missingRecord || missingRecord.batchId !== batchId) {
          throw new NotFoundException(
            `Missing master data record ${missingDataId} was not found for batch ${batchId}`,
          );
        }
        if (missingRecord.creationStatus !== 'created') {
          throw new ConflictException(
            'Customer must be created before its batch can be reprocessed',
          );
        }
        await this.missingMasterDataRepo.updateOne(missingDataId, {
          reprocessStatus: 'processing',
          reprocessErrorMessage: null,
          reprocessAttempts: missingRecord.reprocessAttempts + 1,
        });
      }

      const sourceRecords = await this.getSourceRecordsAsync(batchId);
      const rawData = sourceRecords.map((r) => r.data);
      if (rawData.length === 0) {
        throw new BadRequestException(
          `Batch ${batchId} has no source records to reprocess`,
        );
      }

      const processor = this.processorFactory.getProcessor(
        batch.entryProcessorType,
      );
      let dynData = await processor.formatAndEnrichAsync(
        rawData,
        batch.company,
        batch.billingCodeId,
      );

      dynData = await processor.validateAsync(
        dynData,
        batch.company,
        batch.billingCodeId,
      );

      const groupedMissingData = this.groupMissingMasterData(dynData);
      if (
        missingRecord &&
        groupedMissingData.has(this.getMissingMasterDataKey(missingRecord))
      ) {
        throw new BadRequestException(
          `Created customer still does not resolve ${missingRecord.missingField} ${missingRecord.missingValue}`,
        );
      }

      const successCount = dynData.filter((d) => d.ErrorCount === 0).length;
      const errorCount = dynData.filter((d) => d.ErrorCount > 0).length;
      const expectedGroupCount = this.calculateExpectedGroupCount(dynData);
      const validationRunId = randomUUID();
      replacementValidationRunId = validationRunId;

      if (dynData.length > 0) {
        const storageRecords = dynData.map((record) => ({
          batchId,
          dimensionModel: record.DimensionModel
            ? (Object.assign({}, record.DimensionModel) as unknown as Record<
                string,
                unknown
              >)
            : undefined,
          sourceIds: record.SourceIds || [],
          data: record as unknown as Record<string, unknown>,
          dataModelType: this.getDataModelType(record),
          validationRunId,
        }));
        await this.dataEnhancedRecordRepo.insertMany(storageRecords);
      }

      const errorRecords = dynData.filter((d) => d.ErrorCount > 0);
      if (errorRecords.length > 0) {
        const storageErrors = errorRecords.map((record) => ({
          batchId,
          sourceRecordIds: record.SourceIds || [],
          errorMessages: record.GetErrors(),
          accountDimensionsModel: record.DimensionModel
            ? (Object.assign({}, record.DimensionModel) as unknown as Record<
                string,
                any
              >)
            : undefined,
          enhancedRecordIds: [record.LineNumber?.toString() || ''],
          enhancedData: record as unknown as Record<string, unknown>,
          validationRunId,
        }));
        await this.dataBatchErrorRepo.insertMany(storageErrors);
      }

      const existingMissingRecords =
        await this.missingMasterDataRepo.getList(batchId);
      for (const groupedItem of groupedMissingData.values()) {
        const existingRecord = existingMissingRecords.find(
          (r) =>
            r.type === groupedItem.type &&
            r.missingField === groupedItem.missingField &&
            r.missingValue === groupedItem.missingValue,
        );
        await this.missingMasterDataRepo.upsert(
          batchId,
          groupedItem.type,
          groupedItem.missingField,
          groupedItem.missingValue,
          {
            company: batch.company,
            entryProcessorType: batch.entryProcessorType,
            creationStatus: existingRecord?.creationStatus ?? 'missing',
            reprocessStatus: existingRecord?.reprocessStatus ?? 'not_started',
            affectedCount: groupedItem.affectedCount,
            formDefaults: groupedItem.formDefaults,
            readonlyFormFields: [groupedItem.missingField],
            reprocessAttempts: existingRecord?.reprocessAttempts ?? 0,
          },
        );
      }

      for (const existingRecord of existingMissingRecords) {
        if (
          !groupedMissingData.has(this.getMissingMasterDataKey(existingRecord))
        ) {
          const update: {
            creationStatus?: CustomerCreationStatus;
            reprocessStatus: BatchReprocessStatus;
            reprocessErrorMessage: null;
          } = {
            reprocessStatus: 'succeeded',
            reprocessErrorMessage: null,
          };
          if (existingRecord.creationStatus !== 'created') {
            update.creationStatus = 'created';
          }
          await this.missingMasterDataRepo.updateOne(existingRecord.id, update);
        }
      }

      await this.dataBatchRepo.updateOne(batchId, {
        successCount,
        errorCount,
        totalFormattedCount: dynData.length,
        expectedGroupCount,
        status: DataBatchStatus.PendingPosting,
        activeValidationRunId: replacementValidationRunId,
      });

      if (
        previousValidationRunId &&
        previousValidationRunId !== replacementValidationRunId
      ) {
        try {
          await Promise.all([
            this.dataEnhancedRecordRepo.deleteMany(
              batchId,
              previousValidationRunId,
            ),
            this.dataBatchErrorRepo.deleteMany(
              batchId,
              previousValidationRunId,
            ),
          ]);
        } catch (cleanupError) {
          this.logger.error(
            `Batch ${batchId} switched to validation run ${replacementValidationRunId}, but old run ${previousValidationRunId} cleanup failed: ${
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            }`,
          );
        }
      }

      this.logger.log(
        `Batch reprocessed successfully: id=${batchId} success=${successCount} errors=${errorCount}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reprocess batch ${batchId}: ${error.message}`,
        error.stack,
      );
      if (replacementValidationRunId) {
        await Promise.all([
          this.dataEnhancedRecordRepo.deleteMany(
            batchId,
            replacementValidationRunId,
          ),
          this.dataBatchErrorRepo.deleteMany(
            batchId,
            replacementValidationRunId,
          ),
        ]);
      }
      await this.dataBatchRepo.updateOne(batchId, {
        status: DataBatchStatus.PendingPosting,
      });
      if (missingDataId) {
        await this.missingMasterDataRepo.updateOne(missingDataId, {
          reprocessStatus: 'failed',
          reprocessErrorMessage:
            error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  /**
   * Collects column headers in first-seen order from parsed Excel rows.
   * ExcelJS inserts object keys in worksheet column order, so this preserves
   * the uploaded file's column arrangement.
   */
  private collectSourceColumnHeaders(
    rawData: Array<Record<string, unknown> | object>,
  ): string[] {
    const headers: string[] = [];
    const seen = new Set<string>();

    for (const row of rawData) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        continue;
      }
      for (const key of Object.keys(row)) {
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        headers.push(key);
      }
    }

    return headers;
  }

  private async requireBatch(batchId: string): Promise<IDataBatch> {
    const batch = await this.dataBatchRepo.findById(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    return batch;
  }

  private groupMissingMasterData(
    dynData: DynDataModel[],
  ): Map<string, IMissingMasterDataItem & { affectedCount: number }> {
    const grouped = new Map<
      string,
      IMissingMasterDataItem & { affectedCount: number }
    >();
    for (const record of dynData) {
      for (const item of record.GetMissingMasterData()) {
        const key = this.getMissingMasterDataKey(item);
        const existing = grouped.get(key);
        if (existing) {
          existing.affectedCount++;
        } else {
          grouped.set(key, { ...item, affectedCount: 1 });
        }
      }
    }
    return grouped;
  }

  private getMissingMasterDataKey(
    item: Pick<
      IMissingMasterDataItem,
      'type' | 'missingField' | 'missingValue'
    >,
  ): string {
    return `${item.type}|${item.missingField}|${item.missingValue}`;
  }
}
