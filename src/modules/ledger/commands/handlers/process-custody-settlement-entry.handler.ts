import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCustodySettlementEntryCommand } from '../process-custody-settlement-entry.command';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { CustodySettlementEntryModel } from '@/modules/entry-processor/models/custody-settlement-entry.model';
import { DynCustodySettlementJournalEntryDto } from '@/modules/entry-processor/models/dyn-custody-settlement-journal-entry.dto';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCustodySettlementEntryCommand)
@Injectable()
export class ProcessCustodySettlementEntryHandler implements ICommandHandler<ProcessCustodySettlementEntryCommand> {
  private readonly logger = new Logger(
    ProcessCustodySettlementEntryHandler.name,
  );

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(
    command: ProcessCustodySettlementEntryCommand,
  ): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessCustodySettlementEntry: company=${command.companyId}, bufferLength=${command.fileBuffer?.length || command.rawData?.length || 0}`,
    );

    if (!command.fileBuffer && !command.rawData) {
      throw new BadRequestException(
        'No file or raw data provided for custody settlement entry',
      );
    }

    let rawData: CustodySettlementEntryModel[] = [];

    if (command.rawData) {
      rawData = command.rawData as CustodySettlementEntryModel[];
    } else {
      rawData =
        await this.excelService.excelToJson<CustodySettlementEntryModel>(
          command.fileBuffer!,
        );
    }

    this.logger.debug(`Parsed raw rows: ${rawData.length}`);
    if (rawData.length > 0) {
      this.logger.debug(`First row sample: ${JSON.stringify(rawData[0])}`);
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.LedgerCustodySettlementEntry,
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
      CustodySettlementEntryModel,
      DynCustodySettlementJournalEntryDto
    >(
      EntryProcessorTypes.LedgerCustodySettlementEntry,
      ENTRY_PROCESSOR_NAMES.LEDGER_CUSTODY_SETTLEMENT_ENTRY,
      command.companyId,
      `Custody Settlement Entry ${Date.now()}`,
      rawData,
      validated as DynCustodySettlementJournalEntryDto[],
    );
    this.logger.log(
      `Created data batch: ${batch.id} with ${validated.length} enhanced records`,
    );

    return batch;
  }
}
