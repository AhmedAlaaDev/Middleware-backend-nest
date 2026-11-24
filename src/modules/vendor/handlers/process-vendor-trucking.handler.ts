import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { resolveLegacyCompanyCode } from '@/common/company/company-code';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { runProcessorForCompany } from '@/modules/entry-processor/company-scope/run-for-company';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorTruckingCommand } from '@/modules/vendor/commands';
import { VendorEntryRawDataModel } from '@/modules/vendor/models';

@CommandHandler(ProcessVendorTruckingCommand)
@Injectable()
export class ProcessVendorTruckingHandler implements ICommandHandler<ProcessVendorTruckingCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessVendorTruckingCommand): Promise<IDataBatch> {
    const company = resolveLegacyCompanyCode(companyId);
    const rawData =
      await this.excelService.excelToJson<VendorEntryRawDataModel>(fileBuffer);

    const isTrucking = rawData.every(
      (d) => d.JOURNALNAME && d.JOURNALNAME.toLowerCase().includes('fleet'),
    );

    if (!isTrucking) throw new BadRequestException('Not a trucking journal');

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorTrucking,
    );

    const { validated } = await runProcessorForCompany(
      processor,
      company,
      async () => {
        const enriched = await processor.formatAndEnrichAsync(rawData, company);
        const validated = await processor.validateAsync(enriched, company);
        return { validated };
      },
    );

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorTrucking,
      ENTRY_PROCESSOR_NAMES.VENDOR_TRUCKING,
      company,
      `Vendor Trucking ${Date.now()}`,
      rawData,
      validated,
    );

    return dataBatch;
  }
}
