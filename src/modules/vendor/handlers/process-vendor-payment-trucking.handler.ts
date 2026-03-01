import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';
import { ProcessVendorPaymentTruckingCommand } from '@/modules/vendor/commands';
import { VendorEntryRawDataModel } from '@/modules/vendor/models';

@CommandHandler(ProcessVendorPaymentTruckingCommand)
@Injectable()
export class ProcessVendorPaymentTruckingHandler
  implements ICommandHandler<ProcessVendorPaymentTruckingCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessVendorPaymentTruckingCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';
    const rawData =
      await this.excelService.excelToJson<VendorEntryRawDataModel>(fileBuffer);

    const isPaymentTrucking = rawData.every(
      (d) =>
        d.JOURNALNAME &&
        d.JOURNALNAME.toLowerCase().includes('p-fleet'),
    );

    if (!isPaymentTrucking)
      throw new BadRequestException('Not a vendor payment trucking journal');

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.VendorPaymentTrucking,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.VendorPaymentTrucking,
      ENTRY_PROCESSOR_NAMES.VENDOR_PAYMENT_TRUCKING,
      company,
      `Vendor Payment Fleet ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.vendor.trucking.voucher.number',
    );

    return dataBatch;
  }
}
