import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessTruckingClosingEntryCommand } from '@/modules/closing/commands';
import {
  ClosingEntryModel,
  DynClosingJournalEntryModel,
} from '@/modules/closing/models';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessTruckingClosingEntryCommand)
@Injectable()
export class ProcessTruckingClosingEntryHandler implements ICommandHandler<ProcessTruckingClosingEntryCommand> {
  private readonly logger = new Logger(ProcessTruckingClosingEntryHandler.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(
    command: ProcessTruckingClosingEntryCommand,
  ): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessTruckingClosingEntry: company=${command.companyId}, bufferLength=${command.fileBuffer?.length || 0}`,
    );

    const rawData = await this.excelService.excelToJson<ClosingEntryModel>(
      command.fileBuffer,
    );
    this.logger.debug(`Parsed raw rows: ${rawData.length}`);
    if (rawData.length > 0) {
      this.logger.debug(`First row sample: ${JSON.stringify(rawData[0])}`);
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.LedgerTruckingClosingEntry,
    );

    const enriched = await processor.formatAndEnrichAsync(
      rawData,
      command.companyId,
    );
    const enrichedErrors = enriched.filter((d) => d.ErrorCount > 0).length;
    this.logger.debug(
      `Enriched rows: ${enriched.length}, errors: ${enrichedErrors}`,
    );

    const validated = await processor.validateAsync(
      enriched,
      command.companyId,
    );
    const validatedErrors = validated.filter((d) => d.ErrorCount > 0).length;
    this.logger.debug(
      `Validated rows: ${validated.length}, errors: ${validatedErrors}`,
    );

    const batch = await this.dataBatchService.createAsync<
      ClosingEntryModel,
      DynClosingJournalEntryModel
    >(
      EntryProcessorTypes.LedgerTruckingClosingEntry,
      ENTRY_PROCESSOR_NAMES.LEDGER_TRUCKING_CLOSING_ENTRY,
      command.companyId,
      `Trucking Closing Entry ${Date.now()}`,
      rawData,
      validated as DynClosingJournalEntryModel[],
    );
    this.logger.log(
      `Created data batch: ${batch.id} with ${validated.length} enhanced records`,
    );

    return batch;
  }
}
