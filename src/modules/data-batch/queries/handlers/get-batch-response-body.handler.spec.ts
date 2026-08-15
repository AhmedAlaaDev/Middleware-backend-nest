import { NotFoundException } from '@nestjs/common';

import { GetBatchResponseBodyQuery } from '../get-batch-response-body.query';

import { GetBatchResponseBodyHandler } from './get-batch-response-body.handler';

describe('GetBatchResponseBodyHandler', () => {
  let handler: GetBatchResponseBodyHandler;
  let mockDataBatchService: any;
  let mockDataBatchRepository: any;
  let mockDataBatchErrorRepository: any;
  let mockDataEnhancedRecordRepository: any;
  let mockApplicationLogQueryService: any;
  let mockD365FOClient: any;

  beforeEach(() => {
    mockDataBatchService = {
      getByIdAsync: jest.fn(),
    };
    mockDataBatchRepository = {
      getList: jest.fn(),
    };
    mockDataBatchErrorRepository = {
      getList: jest.fn(),
    };
    mockDataEnhancedRecordRepository = {
      getList: jest.fn().mockResolvedValue([]),
    };
    mockApplicationLogQueryService = {
      getLogsByBatchId: jest.fn(),
    };
    mockD365FOClient = {
      get: jest.fn().mockResolvedValue({ value: [] }),
    };

    handler = new GetBatchResponseBodyHandler(
      mockDataBatchService,
      mockDataBatchRepository,
      mockDataBatchErrorRepository,
      mockDataEnhancedRecordRepository,
      mockApplicationLogQueryService,
      mockD365FOClient,
    );
  });

  it('should return aggregated response body, logs, payloads and batch details', async () => {
    const batchId = '507f1f77bcf86cd799439011';

    mockDataBatchService.getByIdAsync.mockResolvedValue({
      id: batchId,
      company: 'm-p',
      entryProcessorName: 'CashOutFreightEntryProcessor',
      status: 3,
      successCount: 41,
      errorCount: 0,
      totalUploadedCount: 41,
      totalFormattedCount: 41,
      dfoIds: ['Mesco-000013814'],
      dfoPostingErrors: [],
    });

    mockApplicationLogQueryService.getLogsByBatchId.mockResolvedValue([
      {
        eventId: 'evt-1',
        timestamp: new Date(),
        level: 'info',
        context: 'CashOutFreight',
        eventType: 'DFO_POSTING_SUCCESS',
        message: 'Successfully posted journal Mesco-000013814',
        payload: {
          request: { journalBatchNumber: 'Mesco-000013814' },
          response: { status: 200, isPosted: false },
        },
      },
    ]);

    mockDataBatchErrorRepository.getList.mockResolvedValue([]);

    const result = await handler.execute(
      new GetBatchResponseBodyQuery(batchId),
    );

    expect(result.batchId).toBe(batchId);
    expect(result.batch.company).toBe('m-p');
    expect(result.dfoIds).toEqual(['Mesco-000013814']);
    expect(result.logsCount).toBe(1);
    expect(result.logs[0].payload.response.status).toBe(200);
  });

  it('should throw NotFoundException if no batch, logs, or errors exist for batchId', async () => {
    mockDataBatchService.getByIdAsync.mockResolvedValue(null);
    mockDataBatchRepository.getList.mockResolvedValue([]);
    mockApplicationLogQueryService.getLogsByBatchId.mockResolvedValue([]);
    mockDataBatchErrorRepository.getList.mockResolvedValue([]);

    await expect(
      handler.execute(new GetBatchResponseBodyQuery('nonexistent')),
    ).rejects.toThrow(NotFoundException);
  });
});
