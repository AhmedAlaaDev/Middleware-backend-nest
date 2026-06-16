import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARYardCommand } from '@/modules/accounts-receivable/commands';
import {
  AccountReceivableYardFileModel,
  DynAccountReceivableLineModel,
} from '@/modules/accounts-receivable/models';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants/entry-processor-names.constant';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessARYardCommand)
@Injectable()
export class ProcessARYardHandler implements ICommandHandler<ProcessARYardCommand> {
  private readonly logger = new Logger(ProcessARYardHandler.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(command: ProcessARYardCommand): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessARYard: company=${command.companyId}, bufferLength=${command.fileBuffer?.length || 0}`,
    );

    const rawData =
      await this.excelService.excelToJson<AccountReceivableYardFileModel>(
        command.fileBuffer,
      );
    rawData.forEach((row, index) => {
      row.UniqueId = row.UniqueId ?? index + 1;
    });
    this.logger.debug(`Parsed Yard raw rows: ${rawData.length}`);

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.AccountReceivableYard,
    );

    const enriched = await processor.formatAndEnrichAsync(
      rawData,
      command.companyId,
    );
    const validated = await processor.validateAsync(
      enriched,
      command.companyId,
    );

    const batch = await this.dataBatchService.createAsync<
      AccountReceivableYardFileModel,
      DynAccountReceivableLineModel
    >(
      EntryProcessorTypes.AccountReceivableYard,
      ENTRY_PROCESSOR_NAMES.ACCOUNT_RECEIVABLE_YARD,
      command.companyId,
      `Account Receivable Yard, ${Date.now()}`,
      rawData,
      validated as DynAccountReceivableLineModel[],
    );

    this.logger.log(
      `Created Yard data batch: ${batch.id} with ${validated.length} enhanced records`,
    );

    return batch;
  }
}
