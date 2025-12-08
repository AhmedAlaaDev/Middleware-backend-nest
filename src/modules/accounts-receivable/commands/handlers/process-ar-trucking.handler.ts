import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARTruckingCommand } from '../process-ar-trucking.command';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessARTruckingCommand)
@Injectable()
export class ProcessARTruckingHandler implements ICommandHandler<ProcessARTruckingCommand> {
  private readonly logger = new Logger(ProcessARTruckingHandler.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(command: ProcessARTruckingCommand): Promise<any> {
    this.logger.log(
      `Start ProcessARTrucking: company=${command.companyId}, billingCodeId=${command.billingCodeId}, bufferLength=${command.fileBuffer?.length || 0}`,
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
      EntryProcessorTypes.AccountReceivableTrucking,
    );

    const enriched = await processor.formatAndEnrichAsync(
      rawData,
      command.companyId,
      command.billingCodeId || '',
    );
    const enrichedErrors = enriched.filter((d) => d.errorCount > 0).length;
    this.logger.debug(
      `Enriched rows: ${enriched.length}, errors: ${enrichedErrors}`,
    );

    const validated = await processor.validateAsync(
      enriched,
      command.companyId,
      command.billingCodeId || '',
    );
    const validatedErrors = validated.filter((d) => d.errorCount > 0).length;
    this.logger.debug(
      `Validated rows: ${validated.length}, errors: ${validatedErrors}`,
    );

    const batch = await this.dataBatchService.createAsync<
      AccountReceivableFileModel,
      DynAccountReceivableLineDto
    >(
      EntryProcessorTypes.AccountReceivableTrucking,
      'AccountReceivableTruckingEntryProcessor',
      command.companyId,
      `Account Receivable Trucking ${command.billingCodeId} , ${Date.now()}`,
      rawData,
      validated as DynAccountReceivableLineDto[],
      command.billingCodeId,
    );
    this.logger.log(
      `Created data batch: ${(batch as any)?.id || 'unknown'} with ${validated.length} enhanced records`,
    );

    return validated;
  }
}
