import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ProcessCashOutFreightCommand } from '@/modules/cash/commands/process-cash-out-freight.command';
import { CashEntryRawDataModel } from '@/modules/cash/models';
import { CashOutTemplateValidationService } from '@/modules/cash/services/cash-out-template-validation.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { ExcelService } from '@/modules/excel/excel.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QueueService } from '@/modules/queue/services/queue.service';

const CASH_OUT_FREIGHT_VOUCHER_SETTING = 'last.ledger.voucher.cash.out.freight';

@CommandHandler(ProcessCashOutFreightCommand)
@Injectable()
export class ProcessCashOutFreightHandler implements ICommandHandler<ProcessCashOutFreightCommand> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly dataBatchService: DataBatchService,
    private readonly templateValidation: CashOutTemplateValidationService,
    private readonly queueService: QueueService,
    private readonly traceContext: TraceContextService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessCashOutFreightCommand): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const sheet =
      await this.excelService.excelToSheetData<CashEntryRawDataModel>(
        fileBuffer,
      );
    this.templateValidation.assertSupported(sheet.headers);
    const rawData = sheet.rows;

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const dataBatch = await this.dataBatchService.createProcessingShellAsync(
      EntryProcessorTypes.CashOutFreight,
      ENTRY_PROCESSOR_NAMES.CASH_OUT_FREIGHT,
      company,
      `Cash-Out Freight ${Date.now()}`,
      rawData,
    );

    const actor = this.traceContext.get();
    await this.queueService.enqueueBatchImport({
      batchId: dataBatch.id,
      userId: actor?.userId ?? 'system',
      userName: actor?.userName ?? 'System',
      userEmail: actor?.userEmail ?? '',
      voucherNumberSettingLogicalName: CASH_OUT_FREIGHT_VOUCHER_SETTING,
    });

    return dataBatch;
  }
}
