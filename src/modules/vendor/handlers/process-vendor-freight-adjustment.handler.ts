import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorFreightAdjustmentCommand } from '@/modules/vendor/commands';
import { VendorFreightAdjustmentRawData } from '@/modules/vendor/models';

@CommandHandler(ProcessVendorFreightAdjustmentCommand)
@Injectable()
export class ProcessVendorFreightAdjustmentHandler implements ICommandHandler<ProcessVendorFreightAdjustmentCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessVendorFreightAdjustmentCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';
    const rawData =
      await this.excelService.excelToJson<VendorFreightAdjustmentRawData>(
        fileBuffer,
      );

    const isFreight = rawData.every(
      (d) => d.JOURNALNAME && d.JOURNALNAME.toLowerCase().includes('freight'),
    );

    if (!isFreight) throw new BadRequestException('Not a freight journal');

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorFreightAdjustment,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorFreightAdjustment,
      ENTRY_PROCESSOR_NAMES.VENDOR_FREIGHT_ADJUSTMENT,
      company,
      `Vendor Freight Adjustment ${Date.now()}`,
      rawData,
      validated,
    );

    return dataBatch;
  }
}
