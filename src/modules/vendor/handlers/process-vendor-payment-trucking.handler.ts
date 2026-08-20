import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { ExcelService } from '@/modules/excel/excel.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QueueService } from '@/modules/queue/services/queue.service';
import { ProcessVendorPaymentTruckingCommand } from '@/modules/vendor/commands';
import { VendorEntryRawDataModel } from '@/modules/vendor/models';

const VENDOR_PAYMENT_TRUCKING_VOUCHER_SETTING =
  'last.ledger.vendor.trucking.voucher.number';

@CommandHandler(ProcessVendorPaymentTruckingCommand)
@Injectable()
export class ProcessVendorPaymentTruckingHandler implements ICommandHandler<ProcessVendorPaymentTruckingCommand> {
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
  }: ProcessVendorPaymentTruckingCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    if (!fileBuffer && !rawData) {
      throw new BadRequestException(
        'No file or raw data provided for vendor payment trucking entry',
      );
    }

    if (!rawData || rawData.length === 0) {
      rawData = await this.excelService.excelToJson<VendorEntryRawDataModel>(
        fileBuffer as Buffer<ArrayBufferLike>,
      );
    }

    const dataBatch = await this.dataBatchService.createProcessingShellAsync(
      EntryProcessorTypes.VendorPaymentTrucking,
      ENTRY_PROCESSOR_NAMES.VENDOR_PAYMENT_TRUCKING,
      company,
      `Vendor Payment Fleet ${Date.now()}`,
      rawData,
    );

    const actor = this.traceContext.get();
    await this.queueService.enqueueBatchImport({
      batchId: dataBatch.id,
      userId: actor?.userId ?? 'system',
      userName: actor?.userName ?? 'System',
      userEmail: actor?.userEmail ?? '',
      voucherNumberSettingLogicalName:
        VENDOR_PAYMENT_TRUCKING_VOUCHER_SETTING,
    });

    return dataBatch;
  }
}
