/* eslint-disable @typescript-eslint/require-await */
import { CASH_OUT_TEMPLATE_HEADERS } from '@/modules/cash/services/cash-out-template-validation.service';
import { DownloadBatchSourceRecordCommand } from '@/modules/data-batch/commands/download-batch-source-record.command';
import { DownloadBatchSourceRecordHandler } from '@/modules/data-batch/commands/handlers/download-batch-source-record.handler';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

function createCursor(rows: object[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row;
      }
    },
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe(DownloadBatchSourceRecordHandler.name, () => {
  it('keeps saved blank-only source columns in the downloaded workbook', async () => {
    const savedHeaders = [
      'UniqueId',
      'ITEMWITHHOLDINGTAXGROUPCODE',
      'PAYMENTREFERENCE',
      'SafeTransaction',
      'SafeType',
      'VoucherType',
    ];
    const storedRows = [
      {
        _id: { toString: () => 'source-1' },
        batchId: 'batch-1',
        data: { UniqueId: '1' },
      },
    ];
    const batchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        id: 'batch-1',
        entryProcessorType: EntryProcessorTypes.AccountReceivableFreight,
        sourceColumnHeaders: savedHeaders,
      }),
      getSourceRecordsStream: jest
        .fn()
        .mockImplementation(() => createCursor(storedRows)),
    } as unknown as DataBatchService;
    const writeObjectsToTempFileStream = jest
      .fn()
      .mockImplementation(
        async (rows: AsyncIterable<Record<string, unknown>>) => {
          const downloadedRows: Record<string, unknown>[] = [];
          for await (const row of rows) {
            downloadedRows.push(row);
          }
          expect(downloadedRows).toEqual([
            {
              UniqueId: '1',
              ITEMWITHHOLDINGTAXGROUPCODE: '',
              PAYMENTREFERENCE: '',
              SafeTransaction: '',
              SafeType: '',
              VoucherType: '',
            },
          ]);
          return 'source-records.xlsx';
        },
      );
    const excelService = {
      writeObjectsToTempFileStream,
    } as unknown as ExcelService;
    const handler = new DownloadBatchSourceRecordHandler(
      batchService,
      excelService,
    );

    await expect(
      handler.execute(new DownloadBatchSourceRecordCommand('batch-1')),
    ).resolves.toBe('source-records.xlsx');

    expect(writeObjectsToTempFileStream).toHaveBeenCalledWith(
      expect.anything(),
      'batch-batch-1-source-records',
      savedHeaders,
    );
  });

  it('appends record keys that were not present in the saved headers', async () => {
    const storedRows = [
      {
        _id: { toString: () => 'source-1' },
        batchId: 'batch-1',
        data: { UniqueId: '1', ExtraColumn: 'extra' },
      },
    ];
    const batchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        id: 'batch-1',
        entryProcessorType: EntryProcessorTypes.AccountReceivableFreight,
        sourceColumnHeaders: ['UniqueId'],
      }),
      getSourceRecordsStream: jest
        .fn()
        .mockImplementation(() => createCursor(storedRows)),
    } as unknown as DataBatchService;
    const writeObjectsToTempFileStream = jest
      .fn()
      .mockResolvedValue('source-records.xlsx');
    const handler = new DownloadBatchSourceRecordHandler(batchService, {
      writeObjectsToTempFileStream,
    } as unknown as ExcelService);

    await handler.execute(new DownloadBatchSourceRecordCommand('batch-1'));

    expect(writeObjectsToTempFileStream).toHaveBeenCalledWith(
      expect.anything(),
      'batch-batch-1-source-records',
      ['UniqueId', 'ExtraColumn'],
    );
  });

  it('restores the exact approved 51-column template for legacy Cash Out batches', async () => {
    const storedRows = [
      {
        _id: { toString: () => 'source-1' },
        batchId: 'batch-1',
        data: {
          UniqueId: '475761',
          LINENUMBER: '839',
          ISPOSTED: 'No',
        },
      },
    ];
    const legacyHeaders = CASH_OUT_TEMPLATE_HEADERS.filter(
      (header) =>
        ![
          'ITEMWITHHOLDINGTAXGROUPCODE',
          'PAYMENTREFERENCE',
          'SafeTransaction',
          'SafeType',
          'VoucherType',
        ].includes(header),
    );
    const batchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        id: 'batch-1',
        entryProcessorType: EntryProcessorTypes.CashOutFreight,
        sourceColumnHeaders: legacyHeaders,
      }),
      getSourceRecordsStream: jest
        .fn()
        .mockImplementation(() => createCursor(storedRows)),
    } as unknown as DataBatchService;
    const writeObjectsToTempFileStream = jest
      .fn()
      .mockImplementation(
        async (rows: AsyncIterable<Record<string, unknown>>) => {
          const downloadedRows: Record<string, unknown>[] = [];
          for await (const row of rows) {
            downloadedRows.push(row);
          }
          expect(Object.keys(downloadedRows[0])).toEqual([
            ...CASH_OUT_TEMPLATE_HEADERS,
          ]);
          expect(downloadedRows[0]).toEqual(
            expect.objectContaining({
              UniqueId: '475761',
              LINENUMBER: '839',
              ITEMWITHHOLDINGTAXGROUPCODE: '',
              PAYMENTREFERENCE: '',
              SafeTransaction: '',
              SafeType: '',
              VoucherType: '',
            }),
          );
          return 'source-records.xlsx';
        },
      );
    const handler = new DownloadBatchSourceRecordHandler(batchService, {
      writeObjectsToTempFileStream,
    } as unknown as ExcelService);

    await handler.execute(new DownloadBatchSourceRecordCommand('batch-1'));

    expect(writeObjectsToTempFileStream).toHaveBeenCalledWith(
      expect.anything(),
      'batch-batch-1-source-records',
      [...CASH_OUT_TEMPLATE_HEADERS],
    );
  });
});
