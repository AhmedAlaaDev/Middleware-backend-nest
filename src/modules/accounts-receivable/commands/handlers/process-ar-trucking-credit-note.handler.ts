import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARTruckingCreditNoteCommand } from '../process-ar-trucking-credit-note.command';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessARTruckingCreditNoteCommand)
@Injectable()
export class ProcessARTruckingCreditNoteHandler implements ICommandHandler<ProcessARTruckingCreditNoteCommand> {
  private readonly logger = new Logger(ProcessARTruckingCreditNoteHandler.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(
    command: ProcessARTruckingCreditNoteCommand,
  ): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessARTruckingCreditNote: company=${command.companyId}, billingCodeId=${command.billingCodeId}, bufferLength=${command.fileBuffer?.length || 0}`,
    );

    const rawData =
      await this.excelService.excelToJson<AccountReceivableFileModel>(
        command.fileBuffer,
      );
    this.logger.debug(`Parsed raw rows: ${rawData.length}`);
    if (rawData.length > 0) {
      this.logger.debug(`First row sample: ${JSON.stringify(rawData[0])}`);
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.AccountReceivableTruckingCreditNote,
    );

    const enriched = await processor.formatAndEnrichAsync(
      rawData,
      command.companyId,
      command.billingCodeId || '',
    );
    const enrichedErrors = enriched.filter((d) => d.ErrorCount > 0).length;
    this.logger.debug(
      `Enriched rows: ${enriched.length}, errors: ${enrichedErrors}`,
    );

    const validated = await processor.validateAsync(
      enriched,
      command.companyId,
      command.billingCodeId || '',
    );
    const validatedErrors = validated.filter((d) => d.ErrorCount > 0).length;
    this.logger.debug(
      `Validated rows: ${validated.length}, errors: ${validatedErrors}`,
    );

    const batch = await this.dataBatchService.createAsync<
      AccountReceivableFileModel,
      DynAccountReceivableLineDto
    >(
      EntryProcessorTypes.AccountReceivableTruckingCreditNote,
      ENTRY_PROCESSOR_NAMES.ACCOUNT_RECEIVABLE_TRUCKING_CREDIT_NOTE,
      command.companyId,
      `Account Receivable Trucking Credit Note ${command.billingCodeId} , ${Date.now()}`,
      rawData,
      validated as DynAccountReceivableLineDto[],
      command.billingCodeId,
    );
    this.logger.log(
      `Created data batch: ${batch.id} with ${validated.length} enhanced records`,
    );

    return batch;
  }
}
