import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCashOutTruckingCommand } from '@/modules/cash/commands/process-cash-out-trucking.command';
import { CashEntryRawDataModel } from '@/modules/cash/models';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCashOutTruckingCommand)
@Injectable()
export class ProcessCashOutTruckingHandler implements ICommandHandler<ProcessCashOutTruckingCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessCashOutTruckingCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const rawData =
      await this.excelService.excelToJson<CashEntryRawDataModel>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashOutTrucking,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);
    const validated = await processor.validateAsync(enriched, company);

    const metadata = (enriched as any).metadata;

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.CashOutTrucking,
      ENTRY_PROCESSOR_NAMES.CASH_OUT_TRUCKING,
      company,
      `Cash-Out Fleet ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.cash.out.trucking',
      metadata,
    );

    return dataBatch;
  }
}
