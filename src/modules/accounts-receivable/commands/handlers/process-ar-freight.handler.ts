import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARFreightCommand } from '../process-ar-freight.command';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessARFreightCommand)
@Injectable()
export class ProcessARFreightHandler implements ICommandHandler<ProcessARFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(command: ProcessARFreightCommand): Promise<any> {
    const rawData =
      await this.excelService.excelToJson<AccountReceivableFileModel>(
        command.fileBuffer,
      );

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.AccountReceivableFreight,
    );

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

    await this.dataBatchService.createAsync(
      EntryProcessorTypes.AccountReceivableFreight,
      ENTRY_PROCESSOR_NAMES.ACCOUNT_RECEIVABLE_FREIGHT,
      command.companyId,
      `Account Receivable Freight ${command.billingCodeId} , ${Date.now()}`,
      rawData,
      validated,
      command.billingCodeId,
    );

    return validated;
  }
}
