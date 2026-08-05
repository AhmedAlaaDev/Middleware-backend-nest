import { ProcessCashOutTruckingCommand } from '@/modules/cash/commands/process-cash-out-trucking.command';
import { ProcessCashOutTruckingHandler } from '@/modules/cash/handlers/process-cash-out-trucking.handler';
import {
  CASH_OUT_TEMPLATE_HEADERS,
  CashOutTemplateValidationService,
} from '@/modules/cash/services/cash-out-template-validation.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';

describe(ProcessCashOutTruckingHandler.name, () => {
  it('stores an unsupported Fleet template as a failed batch with card counts', async () => {
    const rawRows = Array.from({ length: 2_944 }, (_, index) => ({
      UniqueId: index + 1,
      LINENUMBER: index + 1,
      CloseDate: '2026-02-28',
    }));
    const excelService = {
      excelToSheetData: jest.fn().mockResolvedValue({
        headers: [...CASH_OUT_TEMPLATE_HEADERS, 'CloseDate'],
        rows: rawRows,
      }),
    };
    const processorFactory = { getProcessorByName: jest.fn() };
    const failedBatch = {
      id: 'fleet-template-error',
      totalUploadedCount: 2_944,
      totalFormattedCount: 0,
      successCount: 0,
      errorCount: 1,
    };
    const dataBatchService = {
      createPreFormatValidationFailureAsync: jest
        .fn()
        .mockResolvedValue(failedBatch),
    };
    const handler = new ProcessCashOutTruckingHandler(
      excelService as any,
      processorFactory as any,
      dataBatchService as any,
      new CashOutTemplateValidationService(),
    );

    const result = await handler.execute(
      new ProcessCashOutTruckingCommand(Buffer.from('fleet workbook'), 'm-p'),
    );

    expect(result).toBe(failedBatch);
    expect(processorFactory.getProcessorByName).not.toHaveBeenCalled();
    expect(
      dataBatchService.createPreFormatValidationFailureAsync,
    ).toHaveBeenCalledWith(
      EntryProcessorTypes.CashOutTrucking,
      ENTRY_PROCESSOR_NAMES.CASH_OUT_TRUCKING,
      'm-p',
      expect.stringMatching(/^Cash-Out Fleet /),
      rawRows,
      [expect.stringContaining('unsupported columns: CloseDate')],
    );
  });
});
