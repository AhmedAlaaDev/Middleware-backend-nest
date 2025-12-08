import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorFreightCommand } from '@/modules/vendor/commands/process-vendor-freight.comand';
import { VendorFreightRawData } from '@/modules/vendor/models/vendor-freight-raw-data.model';

@CommandHandler(ProcessVendorFreightCommand)
@Injectable()
export class ProcessVendorFreightHandler implements ICommandHandler<ProcessVendorFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessVendorFreightCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';
    const rawData =
      await this.excelService.excelToJson<VendorFreightRawData>(fileBuffer);

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorFreight,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorFreight,
      ENTRY_PROCESSOR_NAMES.VENDOR_FREIGHT,
      company,
      `Vendor Freight ${Date.now()}`,
      rawData,
      validated,
    );

    return dataBatch;
  }
}
