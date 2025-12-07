import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessARFreightCommand } from '../process-ar-freight.command';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { ExcelService } from '@/modules/excel/excel.service';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

@CommandHandler(ProcessARFreightCommand)
@Injectable()
export class ProcessARFreightHandler implements ICommandHandler<ProcessARFreightCommand> {
  private readonly logger = new Logger(ProcessARFreightHandler.name);
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute(command: ProcessARFreightCommand): Promise<IDataBatch> {
    this.logger.log(
      `Start ProcessARFreight: company=${command.companyId}, billingCodeId=${command.billingCodeId}, bufferLength=${command.fileBuffer?.length || 0}`,
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
      'AccountReceivableFreightEntryProcessor',
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

    const batch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.AccountReceivableFreight,
      'AccountReceivableFreightEntryProcessor',
      command.companyId,
      `Account Receivable Freight ${command.billingCodeId} , ${Date.now()}`,
      rawData,
      validated,
      command.billingCodeId,
    );
    this.logger.log(
      `Created data batch: ${batch.id} with ${validated.length} enhanced records`,
    );

    return batch;
  }
}
