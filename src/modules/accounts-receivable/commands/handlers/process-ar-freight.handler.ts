import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARFreightCommand } from '../process-ar-freight.command';

import { ExcelService } from '@/modules/excel/excel.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service'
import { EntryProcessorTypes as DbEntryProcessorTypes } from '@/modules/db/schemas/data-batch.schema'

@CommandHandler(ProcessARFreightCommand)
@Injectable()
export class ProcessARFreightHandler
  implements ICommandHandler<ProcessARFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService
  ) { }

  public async execute(command: ProcessARFreightCommand): Promise<any> {
    const rawData = await this.excelService.excelToJson<AccountReceivableFileModel>(command.fileBuffer);

    const processor = this.processorFactory.getProcessorByName(
      'AccountReceivableFreightEntryProcessor',
    )

    const enriched = await processor.formatAndEnrichAsync(
      rawData,
      command.companyId,
      command.billingCodeId || '',
    );

    const validated = await processor.validateAsync(
      enriched,
      command.companyId,
      command.billingCodeId || '',
    );

    const batch = await this.dataBatchService.createAsync(
      DbEntryProcessorTypes.AccountReceivableFreight,
      'AccountReceivableFreightEntryProcessor',
      command.companyId,
      `Account Receivable Freight ${command.billingCodeId} , ${Date.now()}`,
      rawData,
      validated,
      command.billingCodeId,
    );

    return validated;
  }
}
