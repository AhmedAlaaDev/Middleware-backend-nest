import { BadRequestException } from '@nestjs/common';

import { ProcessCashInYardHandler } from './process-cash-in-yard.handler';

import { ProcessCashInYardCommand } from '@/modules/cash/commands';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

/**
 * Company propagation for the Cash-In Yard document upload: the companyId on
 * the command must reach the processor, the review batch and nothing else.
 */
describe('ProcessCashInYardHandler company propagation', () => {
  const rows = [{ UniqueId: 1 }];

  const build = () => {
    const processor = {
      entryProcessorType: EntryProcessorTypes.CashInYard,
      resetCompanyScopedState: jest.fn(),
      formatAndEnrichAsync: jest.fn(() =>
        Promise.resolve([{ enriched: true }]),
      ),
      validateAsync: jest.fn((data: unknown[]) => Promise.resolve(data)),
    };
    const excelService = {
      excelToJson: jest.fn(() => Promise.resolve(rows)),
    };
    const processorFactory = {
      getProcessorByName: jest.fn(() => processor),
    };
    const dataBatchService = {
      createAsync: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ id: 'batch-1' }),
      ),
    };
    const handler = new ProcessCashInYardHandler(
      excelService as never,
      processorFactory as never,
      dataBatchService as never,
    );
    return { handler, processor, dataBatchService };
  };

  it('sends an explicit mas through the processor and into the saved batch', async () => {
    const { handler, processor, dataBatchService } = build();

    await handler.execute(
      new ProcessCashInYardCommand(Buffer.from('x'), 'mas'),
    );

    expect(processor.resetCompanyScopedState).toHaveBeenCalledWith('mas');
    expect(processor.formatAndEnrichAsync).toHaveBeenCalledWith(rows, 'mas');
    expect(processor.validateAsync).toHaveBeenCalledWith(
      [{ enriched: true }],
      'mas',
    );
    expect(dataBatchService.createAsync).toHaveBeenCalledWith(
      EntryProcessorTypes.CashInYard,
      expect.any(String),
      'mas',
      expect.any(String),
      rows,
      expect.anything(),
      undefined,
      expect.any(String),
    );
  });

  it('keeps m-p when m-p is explicit', async () => {
    const { handler, dataBatchService } = build();
    await handler.execute(
      new ProcessCashInYardCommand(Buffer.from('x'), 'm-p'),
    );
    expect(dataBatchService.createAsync.mock.calls[0][2]).toBe('m-p');
  });

  it('uses m-p only when a legacy caller omits companyId', async () => {
    const { handler, dataBatchService } = build();
    await handler.execute(new ProcessCashInYardCommand(Buffer.from('x')));
    expect(dataBatchService.createAsync.mock.calls[0][2]).toBe('m-p');
  });

  it('rejects an unsupported company before any processing happens', async () => {
    const { handler, processor, dataBatchService } = build();
    await expect(
      handler.execute(new ProcessCashInYardCommand(Buffer.from('x'), 'acme')),
    ).rejects.toThrow(BadRequestException);
    expect(processor.formatAndEnrichAsync).not.toHaveBeenCalled();
    expect(dataBatchService.createAsync).not.toHaveBeenCalled();
  });
});
