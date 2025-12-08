import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorTruckingAdjustmentCommand } from '@/modules/vendor/commands/process-vendor-trucking-adjustment.comand';
import { VendorTruckingAdjustmentRawData } from '@/modules/vendor/models/vendor-trucking-adjustment-raw-data.model';

@CommandHandler(ProcessVendorTruckingAdjustmentCommand)
@Injectable()
export class ProcessVendorTruckingAdjustmentHandler implements ICommandHandler<ProcessVendorTruckingAdjustmentCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessVendorTruckingAdjustmentCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';
    const rawData =
      await this.excelService.excelToJson<VendorTruckingAdjustmentRawData>(
        fileBuffer,
      );

    const isTrucking = rawData.every(
      (d) => d.JOURNALNAME && d.JOURNALNAME.toLowerCase().includes('fleet'),
    );

    if (!isTrucking) throw new BadRequestException('Not a trucking journal');

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorTruckingAdjustment,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorTruckingAdjustment,
      ENTRY_PROCESSOR_NAMES.VENDOR_TRUCKING_ADJUSTMENT,
      company,
      `Vendor Trucking Adjustment ${Date.now()}`,
      rawData,
      validated,
    );

    return dataBatch;
  }
}
