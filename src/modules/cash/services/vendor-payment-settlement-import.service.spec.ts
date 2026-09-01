import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';

import { VendorPaymentSettlementImportService } from './vendor-payment-settlement-import.service';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

const HEADERS = [
  'Voucher',
  'Company',
  'Account',
  'Description',
  'Debit',
  'Credit',
  'Currency',
  'Line number',
];

async function workbookBuffer(
  rows: Array<Array<string | number>>,
  headers = HEADERS,
): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function sourceRow(description = 'Unmarked - 2379792') {
  return [
    'P-Freight-000069621',
    'm-p',
    'Al-000006',
    description,
    798,
    0,
    'EGP',
    2,
  ];
}

describe('VendorPaymentSettlementImportService', () => {
  let d365: {
    get: jest.Mock;
    post: jest.Mock;
  };
  let logs: { emit: jest.Mock };
  let service: VendorPaymentSettlementImportService;
  let settlementCreated: boolean;

  beforeEach(() => {
    settlementCreated = false;
    d365 = {
      get: jest.fn((endpoint: string) => {
        if (endpoint.startsWith('/data/VendorPaymentJournalLines')) {
          return Promise.resolve({
            value: [
              {
                dataAreaId: 'm-p',
                JournalBatchNumber: 'Mesco-000015460',
                LineNumber: 2,
                Voucher: 'P-Freight-000069621',
                AccountDisplayValue: 'Al-000006',
                DebitAmount: 798,
                CreditAmount: 0,
                CurrencyCode: 'EGP',
              },
            ],
          });
        }
        if (endpoint.startsWith('/data/VendTransBiEntities')) {
          return Promise.resolve({
            value: [
              {
                Invoice: '2379792',
                AccountNum: 'Al-000006',
                CurrencyCode: 'EGP',
                Closed: '1900-01-01T12:00:00Z',
                AmountCur: -798,
                SettleAmountCur: 0,
                DueDate: '2026-02-01T12:00:00Z',
              },
            ],
          });
        }
        if (
          endpoint.startsWith('/data/VendorPaymentJournalLineSettledInvoices')
        ) {
          return Promise.resolve({
            value: settlementCreated
              ? [
                  {
                    JournalLineCompany: 'm-p',
                    JournalBatchNumber: 'Mesco-000015460',
                    JournalLineNumber: 2,
                    InvoiceNumber: '2379792',
                    InvoiceCompany: 'm-p',
                    InvoiceDueDate: '2026-02-01T12:00:00Z',
                    SettlementAmountInInvoiceCurrency: -798,
                  },
                ]
              : [],
          });
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      }),
      post: jest.fn(() => {
        settlementCreated = true;
        return Promise.resolve({});
      }),
    };
    logs = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new VendorPaymentSettlementImportService(
      new ExcelService(new ExcelJsAdapter()),
      d365 as unknown as D365FOClientService,
      new ODataQueryBuilderService(),
      logs as unknown as OperationalLoggerService,
    );
  });

  it('validates a workbook row without posting in dry-run mode', async () => {
    const result = await service.process(
      await workbookBuffer([sourceRow()]),
      true,
    );

    expect(result.summary).toEqual({
      ready: 1,
      markedAndVerified: 0,
      alreadyMarked: 0,
      invalid: 0,
      postFailed: 0,
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        excelRow: 2,
        invoiceNumber: '2379792',
        settlementAmount: -798,
        status: 'ready',
      }),
    );
    expect(d365.post).not.toHaveBeenCalled();
  });

  it('posts the correct payload and verifies the created settlement', async () => {
    const result = await service.process(await workbookBuffer([sourceRow()]));

    expect(d365.post).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLineSettledInvoices',
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015460',
        JournalLineNumber: 2,
        InvoiceNumber: '2379792',
        InvoiceCompany: 'm-p',
        InvoiceDueDate: '2026-02-01T12:00:00Z',
        SettlementAmountInInvoiceCurrency: -798,
        CashDiscountToTakeInInvoiceCurrency: 0,
      },
      { retries: 0 },
    );
    expect(result.summary.markedAndVerified).toBe(1);
    expect(result.results[0].status).toBe('marked_and_verified');
  });

  it('skips an existing settlement without posting it again', async () => {
    settlementCreated = true;

    const result = await service.process(await workbookBuffer([sourceRow()]));

    expect(result.summary.alreadyMarked).toBe(1);
    expect(result.results[0].status).toBe('already_marked');
    expect(d365.post).not.toHaveBeenCalled();
  });

  it('reports a closed invoice as invalid and continues without posting', async () => {
    d365.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/data/VendorPaymentJournalLines')) {
        return Promise.resolve({
          value: [
            {
              JournalBatchNumber: 'Mesco-000015460',
              AccountDisplayValue: 'Al-000006',
              DebitAmount: 798,
              CreditAmount: 0,
              CurrencyCode: 'EGP',
            },
          ],
        });
      }
      if (endpoint.startsWith('/data/VendTransBiEntities')) {
        return Promise.resolve({
          value: [
            {
              Invoice: '2379792',
              AccountNum: 'Al-000006',
              CurrencyCode: 'EGP',
              Closed: '2026-08-01T12:00:00Z',
              AmountCur: -798,
              SettleAmountCur: -798,
              DueDate: '2026-02-01T12:00:00Z',
            },
          ],
        });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const result = await service.process(await workbookBuffer([sourceRow()]));

    expect(result.summary.invalid).toBe(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: 'invalid',
        message: 'Expected one open invoice transaction but found 0.',
      }),
    );
    expect(d365.post).not.toHaveBeenCalled();
  });

  it('rejects a workbook that is missing required columns', async () => {
    await expect(
      service.process(
        await workbookBuffer(
          [['P-Freight-1', 'Unmarked - 1']],
          ['Voucher', 'Description'],
        ),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(d365.get).not.toHaveBeenCalled();
  });

  it('rejects grouped payment rows whose combined amount exceeds the invoice remainder', async () => {
    d365.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/data/VendorPaymentJournalLines')) {
        const decoded = decodeURIComponent(endpoint);
        const lineNumber = decoded.includes('LineNumber eq 3') ? 3 : 2;
        return Promise.resolve({
          value: [
            {
              JournalBatchNumber: 'Mesco-000015460',
              AccountDisplayValue: 'Al-000006',
              DebitAmount: 500,
              CreditAmount: 0,
              CurrencyCode: 'EGP',
              LineNumber: lineNumber,
            },
          ],
        });
      }
      if (endpoint.startsWith('/data/VendTransBiEntities')) {
        return Promise.resolve({
          value: [
            {
              Invoice: '2379792',
              AccountNum: 'Al-000006',
              CurrencyCode: 'EGP',
              Closed: '1900-01-01T12:00:00Z',
              AmountCur: -798,
              SettleAmountCur: 0,
              DueDate: '2026-02-01T12:00:00Z',
            },
          ],
        });
      }
      if (
        endpoint.startsWith('/data/VendorPaymentJournalLineSettledInvoices')
      ) {
        return Promise.resolve({ value: [] });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const result = await service.process(
      await workbookBuffer([
        [
          'P-Freight-000069621',
          'm-p',
          'Al-000006',
          'Unmarked - 2379792',
          500,
          0,
          'EGP',
          2,
        ],
        [
          'P-Freight-000069622',
          'm-p',
          'Al-000006',
          'Unmarked - 2379792',
          500,
          0,
          'EGP',
          3,
        ],
      ]),
      true,
    );

    expect(result.summary.invalid).toBe(2);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'invalid',
          message: expect.stringContaining('total 1000'),
        }),
      ]),
    );
    expect(d365.post).not.toHaveBeenCalled();
  });
});
