import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorTruckingAdjustmentCommand } from '@/modules/vendor/commands';
import { VendorFreightRawData } from '@/modules/vendor/models';

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
      await this.excelService.excelToJson<VendorFreightRawData>(fileBuffer);

    const isTrucking = rawData.every(
      (d) => d.JOURNALNAME && d.JOURNALNAME.toLowerCase().includes('fleet'),
    );

    if (!isTrucking) throw new BadRequestException('Not a trucking journal');

    const processor = this.processorFactory.getProcessor(
      EntryProcessorTypes.VendorTrucking,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorTrucking,
      ENTRY_PROCESSOR_NAMES.VENDOR_TRUCKING,
      company,
      `Vendor Trucking Adjustment ${Date.now()}`,
      rawData,
      validated,
    );

    return dataBatch;
  }
}
