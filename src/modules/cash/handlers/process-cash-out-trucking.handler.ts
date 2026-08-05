import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCashOutTruckingCommand } from '@/modules/cash/commands/process-cash-out-trucking.command';
import { CashEntryRawDataModel } from '@/modules/cash/models';
import { CashOutTemplateValidationService } from '@/modules/cash/services/cash-out-template-validation.service';
import { getCashOutPreFormatValidationErrors } from '@/modules/cash/utils/cash-out-pre-format-validation';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCashOutTruckingCommand)
@Injectable()
export class ProcessCashOutTruckingHandler implements ICommandHandler<ProcessCashOutTruckingCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
    private readonly templateValidation: CashOutTemplateValidationService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
    rawData: injectedRawData,
  }: ProcessCashOutTruckingCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    let rawData: CashEntryRawDataModel[] = [];

    if (injectedRawData?.length) {
      // Cash-In SafeType routing may hand off Custody Settlement rows already
      // parsed from the Cash-In workbook — skip Cash-Out template checks.
      rawData = injectedRawData as CashEntryRawDataModel[];
    } else {
      if (!fileBuffer) {
        throw new BadRequestException('Empty file');
      }

      const sheet =
        await this.excelService.excelToSheetData<CashEntryRawDataModel>(
          fileBuffer,
        );
      rawData = sheet.rows;
      const templateErrors = this.templateValidation.getValidationErrors(
        sheet.headers,
      );
      if (templateErrors.length > 0) {
        return this.dataBatchService.createPreFormatValidationFailureAsync(
          EntryProcessorTypes.CashOutTrucking,
          ENTRY_PROCESSOR_NAMES.CASH_OUT_TRUCKING,
          company,
          `Cash-Out Fleet ${Date.now()}`,
          rawData,
          templateErrors,
        );
      }
    }

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashOutTrucking,
    );

    let enriched;
    try {
      enriched = await processor.formatAndEnrichAsync(rawData, company);
    } catch (error: unknown) {
      const validationErrors = getCashOutPreFormatValidationErrors(error);
      if (!validationErrors) throw error;

      return this.dataBatchService.createPreFormatValidationFailureAsync(
        EntryProcessorTypes.CashOutTrucking,
        ENTRY_PROCESSOR_NAMES.CASH_OUT_TRUCKING,
        company,
        `Cash-Out Fleet ${Date.now()}`,
        rawData,
        validationErrors,
      );
    }
    const validated = await processor.validateAsync(enriched, company);

    const metadata = enriched.metadata;

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.CashOutTrucking,
      ENTRY_PROCESSOR_NAMES.CASH_OUT_TRUCKING,
      company,
      `Cash-Out Fleet ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.cash.out.trucking',
      metadata,
    );

    return dataBatch;
  }
}
