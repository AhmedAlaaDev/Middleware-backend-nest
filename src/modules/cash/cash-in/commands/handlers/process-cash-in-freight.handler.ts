import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCashInFreightCommand } from '@/modules/cash/cash-in/commands/process-cash-in-freight.comand';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCashInFreightCommand)
@Injectable()
export class ProcessCashInFreightHandler implements ICommandHandler<ProcessCashInFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessCashInFreightCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const rawData =
      await this.excelService.excelToJson<RawDataModel>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashInFreight,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);

    // return {
    //   id: 'test',
    //   company: 'm-p',
    //   entryProcessorType: EntryProcessorTypes.CashInFreight,
    //   entryProcessorName: ENTRY_PROCESSOR_NAMES.CASH_IN_FREIGHT,
    //   description: `Cash-In Freight ${Date.now()}`,
    //   successCount: 0,
    //   errorCount: 0,
    //   totalFormattedCount: 0,
    //   totalUploadedCount: 0,
    //   status: 1,
    //   creationDate: new Date(),
    // };
    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.CashInFreight,
      ENTRY_PROCESSOR_NAMES.CASH_IN_FREIGHT,
      company,
      `Cash-In Freight ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.cash.in.freight',
    );

    return dataBatch;
  }
}
