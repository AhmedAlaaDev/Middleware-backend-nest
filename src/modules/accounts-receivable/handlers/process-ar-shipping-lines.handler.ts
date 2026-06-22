import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARShippingLinesCommand } from '@/modules/accounts-receivable/commands';
import {
  AccountReceivableShippingLinesFileModel,
  DynAccountReceivableLineModel,
} from '@/modules/accounts-receivable/models';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants/entry-processor-names.constant';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessARShippingLinesCommand)
@Injectable()
export class ProcessARShippingLinesHandler implements ICommandHandler<ProcessARShippingLinesCommand> {
  private readonly logger = new Logger(ProcessARShippingLinesHandler.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(
    command: ProcessARShippingLinesCommand,
  ): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessARShippingLines: company=${command.companyId}, bufferLength=${command.fileBuffer?.length || 0}`,
    );

    const rawRows =
      await this.excelService.excelToJson<AccountReceivableShippingLinesFileModel>(
        command.fileBuffer,
      );
    rawRows.forEach((row, index) => {
      row.UniqueId = row.UniqueId ?? index + 1;
    });

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.AccountReceivableShippingLines,
    );
    const enrichedRows = await processor.formatAndEnrichAsync(
      rawRows,
      command.companyId,
    );
    const validatedRows = await processor.validateAsync(
      enrichedRows,
      command.companyId,
    );

    return this.dataBatchService.createAsync<
      AccountReceivableShippingLinesFileModel,
      DynAccountReceivableLineModel
    >(
      EntryProcessorTypes.AccountReceivableShippingLines,
      ENTRY_PROCESSOR_NAMES.ACCOUNT_RECEIVABLE_SHIPPING_LINES,
      command.companyId,
      `Account Receivable Shipping Lines, ${Date.now()}`,
      rawRows,
      validatedRows as DynAccountReceivableLineModel[],
    );
  }
}
