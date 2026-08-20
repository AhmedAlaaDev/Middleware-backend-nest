import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { ExcelService } from '@/modules/excel/excel.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QueueService } from '@/modules/queue/services/queue.service';
import { ProcessVendorPaymentFreightCommand } from '@/modules/vendor/commands';
import { VendorEntryRawDataModel } from '@/modules/vendor/models';

const VENDOR_PAYMENT_FREIGHT_VOUCHER_SETTING =
  'last.ledger.vendor.freight.voucher.number';

@CommandHandler(ProcessVendorPaymentFreightCommand)
@Injectable()
export class ProcessVendorPaymentFreightHandler implements ICommandHandler<ProcessVendorPaymentFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
    private readonly traceContext: TraceContextService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
    rawData,
  }: ProcessVendorPaymentFreightCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    if (!fileBuffer && !rawData) {
      throw new BadRequestException(
        'No file or raw data provided for vendor payment freight entry',
      );
    }

    if (!rawData || rawData.length === 0) {
      rawData = await this.excelService.excelToJson<VendorEntryRawDataModel>(
        fileBuffer as Buffer<ArrayBufferLike>,
      );
    }

    const dataBatch = await this.dataBatchService.createProcessingShellAsync(
      EntryProcessorTypes.VendorPaymentFreight,
      ENTRY_PROCESSOR_NAMES.VENDOR_PAYMENT_FREIGHT,
      company,
      `Vendor Payment Freight ${Date.now()}`,
      rawData,
    );

    const actor = this.traceContext.get();
    await this.queueService.enqueueBatchImport({
      batchId: dataBatch.id,
      userId: actor?.userId ?? 'system',
      userName: actor?.userName ?? 'System',
      userEmail: actor?.userEmail ?? '',
      voucherNumberSettingLogicalName:
        VENDOR_PAYMENT_FREIGHT_VOUCHER_SETTING,
    });

    return dataBatch;
  }
}
