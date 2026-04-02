import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorPaymentFreightCommand } from '@/modules/vendor/commands';
import { VendorEntryRawDataModel } from '@/modules/vendor/models';

@CommandHandler(ProcessVendorPaymentFreightCommand)
@Injectable()
export class ProcessVendorPaymentFreightHandler implements ICommandHandler<ProcessVendorPaymentFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
    rawData,
  }: ProcessVendorPaymentFreightCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    if (!fileBuffer && !rawData) {
      throw new BadRequestException(
        'No file or raw data provided for custody settlement entry',
      );
    }

    if (!rawData || rawData.length === 0) {
      rawData = await this.excelService.excelToJson<VendorEntryRawDataModel>(
        fileBuffer as Buffer<ArrayBufferLike>,
      );
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorPaymentFreight,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorPaymentFreight,
      ENTRY_PROCESSOR_NAMES.VENDOR_PAYMENT_FREIGHT,
      company,
      `Vendor Payment Freight ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.vendor.freight.voucher.number',
    );

    return dataBatch;
  }
}
