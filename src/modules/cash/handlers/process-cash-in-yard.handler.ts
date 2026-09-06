import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCashInYardCommand } from '@/modules/cash/commands';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { EntryRawDataModel } from '@/modules/entry-processor/models';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCashInYardCommand)
@Injectable()
export class ProcessCashInYardHandler
  implements ICommandHandler<ProcessCashInYardCommand>
{
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessCashInYardCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const rawData =
      await this.excelService.excelToJson<EntryRawDataModel>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashInYard,
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);
    const validated = await processor.validateAsync(enriched, company);

    return this.dataBatchService.createAsync(
      EntryProcessorTypes.CashInYard,
      ENTRY_PROCESSOR_NAMES.CASH_IN_YARD,
      company,
      `Cash-In Yard ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.cash.in.yard',
    );
  }
}
