import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';

import { ShiplinkSettlementPayloadExportService } from '@/modules/data-batch/services/shiplink-settlement-payload-export.service';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';

describe('ShiplinkSettlementPayloadExportService.settleUploadedPayloads', () => {
  const line = (overrides?: Record<string, unknown>) => ({
    JournalLineCompany: 'm-p',
    JournalBatchNumber: 'Mesco-000015882',
    JournalLineNumber: 1,
    InvoiceNumber: '000009219/Inv-SH',
    InvoiceCompany: 'm-p',
    InvoiceDueDate: '2026-01-14T00:00:00Z',
    SettlementAmountInInvoiceCurrency: 2,
    ...overrides,
  });

  const buildService = () => {
    const d365 = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({}),
    };
    const service = new ShiplinkSettlementPayloadExportService(
      {} as DataBatchService,
      d365 as never,
      new ODataQueryBuilderService(),
      new ExcelService(new ExcelJsAdapter()),
    );
    return { service, d365 };
  };

  const mockLookups = (
    d365: { get: jest.Mock },
    options?: {
      existing?: Array<Record<string, unknown>>;
      custTrans?: Array<Record<string, unknown>>;
    },
  ) => {
    d365.get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('PaymentJournalLineSettledInvoices')) {
        return { value: options?.existing ?? [] };
      }
      if (endpoint.includes('CustTransBiEntities')) {
        return {
          value: options?.custTrans ?? [
            {
              Invoice: '000009219/Inv-SH',
              DueDate: '2026-01-31T12:00:00Z',
              Closed: '1900-01-01T12:00:00Z',
              AmountCur: 10,
              SettleAmountCur: 0,
              RemainAmountCur: 10,
            },
          ],
        };
      }
      return { value: [] };
    });
  };

  it('posts each pasted JSON line to PaymentJournalLineSettledInvoices', async () => {
    const { service, d365 } = buildService();
    mockLookups(d365);
    const payloads = [
      line(),
      line({
        JournalLineNumber: 2,
        SettlementAmountInInvoiceCurrency: 8,
      }),
    ];

    const report = await service.settleUploadedPayloads(payloads);

    expect(d365.post).toHaveBeenCalledTimes(2);
    expect(d365.post.mock.calls[0][0]).toBe(
      '/data/PaymentJournalLineSettledInvoices',
    );
    expect(d365.post.mock.calls[1][0]).toBe(
      '/data/PaymentJournalLineSettledInvoices',
    );
    expect(d365.post.mock.calls[0][2]).toEqual({ retries: 0 });
    expect(report.requestedCount).toBe(2);
    expect(report.postedCount).toBe(2);
    expect(report.failedCount).toBe(0);
  });

  it('replaces the payment date with the open invoice due date from Finance', async () => {
    const { service, d365 } = buildService();
    mockLookups(d365);

    await service.settleUploadedPayloads([line()]);

    expect(d365.post.mock.calls[0][1]).toMatchObject({
      JournalLineNumber: 1,
      InvoiceNumber: '000009219/Inv-SH',
      InvoiceDueDate: '2026-01-31T12:00:00Z',
      SettlementAmountInInvoiceCurrency: 2,
    });
  });

  it('keeps posting remaining lines when one PaymentJournalLineSettledInvoices write fails', async () => {
    const { service, d365 } = buildService();
    mockLookups(d365);
    d365.post
      .mockRejectedValueOnce(new Error('HTTP 400: CustTransOpen does not exist'))
      .mockResolvedValueOnce({});

    const report = await service.settleUploadedPayloads([
      line(),
      line({
        JournalLineNumber: 2,
        InvoiceNumber: '000011864/Inv-SH',
        SettlementAmountInInvoiceCurrency: 50,
      }),
    ]);

    expect(d365.post).toHaveBeenCalledTimes(2);
    expect(report.postedCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(report.failures[0].payload.JournalLineNumber).toBe(1);
  });

  it('rejects a non-array body', async () => {
    const { service } = buildService();
    await expect(
      service.settleUploadedPayloads({ line: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts a single generated batch JSON even if the query journal number does not match', async () => {
    const { service, d365 } = buildService();
    mockLookups(d365);

    const report = await service.settleUploadedPayloadsByJournalBatch(
      [line()],
      'Mesco-000016627',
    );

    expect(d365.post).toHaveBeenCalledTimes(1);
    expect(report.journalBatchNumber).toBe('Mesco-000015882');
    expect(report.postedCount).toBe(1);
  });

  it('rejects a mixed SettlementLines file when the query journal is not in the body', async () => {
    const { service } = buildService();

    await expect(
      service.settleUploadedPayloadsByJournalBatch(
        [
          line(),
          line({
            JournalBatchNumber: 'Mesco-000016627',
            JournalLineNumber: 2,
          }),
        ],
        'Mesco-000099999',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ShiplinkSettlementPayloadExportService.settleFromExcelFiles', () => {
  const buildService = () => {
    const d365 = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({}),
    };
    const service = new ShiplinkSettlementPayloadExportService(
      {} as DataBatchService,
      d365 as never,
      new ODataQueryBuilderService(),
      new ExcelService(new ExcelJsAdapter()),
    );
    return { service, d365 };
  };

  const workbookBuffer = async (
    sheetName: string,
    headers: string[],
    rows: unknown[][],
  ): Promise<Buffer> => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };

  const enhancedWorkbook = () =>
    workbookBuffer(
      'Enhanced_source',
      [
        'JournalBatchNumber',
        'LineNumber',
        'Invoice',
        'Company',
        'AccountType',
        'AccountDisplayValue',
        'CreditAmount',
        'Status',
        'Settlement Methode',
        'DueDate',
      ],
      [
        [
          'Mesco-000015882',
          1,
          '000009219/Inv-SH',
          'm-p',
          'Cust',
          '101004344',
          2,
          'Ready',
          'Upload',
          '',
        ],
        [
          'Mesco-000015882',
          2,
          '000009219/Inv-SH',
          'm-p',
          'Cust',
          '101004344',
          8,
          'Ready',
          'Settle "524529"',
          '',
        ],
        [
          'Mesco-000015882',
          3,
          '000001350/OF-SH',
          'm-p',
          'Ledger',
          '524529--SHIP',
          100,
          'Remove',
          'Remove',
          '',
        ],
        [
          'Mesco-000016627',
          1,
          '000011864/Inv-SH',
          'm-p',
          'Cust',
          '101005148',
          50,
          'Ready',
          'No Settlement',
          '',
        ],
      ],
    );

  const invoiceWorkbook = () =>
    workbookBuffer(
      'Invoices',
      ['FREETEXTNUMBER', 'DueDate'],
      [
        ['000009219/Inv-SH', new Date(Date.UTC(2026, 0, 31))],
        ['000011864/Inv-SH', new Date(Date.UTC(2026, 1, 15))],
      ],
    );

  it('builds settlement bodies from enhanced records and invoice due dates', async () => {
    const { service, d365 } = buildService();
    const report = await service.settleFromExcelFiles(
      await enhancedWorkbook(),
      await invoiceWorkbook(),
      { dryRun: true },
    );

    expect(d365.post).not.toHaveBeenCalled();
    expect(report.dryRun).toBe(true);
    expect(report.requestedCount).toBe(2);
    expect(report.payloads).toEqual([
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015882',
        JournalLineNumber: 1,
        InvoiceNumber: '000009219/Inv-SH',
        InvoiceCompany: 'm-p',
        InvoiceDueDate: '2026-01-31T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2,
      },
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015882',
        JournalLineNumber: 2,
        InvoiceNumber: '000009219/Inv-SH',
        InvoiceCompany: 'm-p',
        InvoiceDueDate: '2026-01-31T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 8,
      },
    ]);
    expect(report.skipped.map((row) => row.reason).sort()).toEqual([
      'SKIPPED_LEDGER_VARIANCE',
      'SKIPPED_NO_SETTLEMENT',
    ]);
  });

  it('posts the Excel-built bodies to PaymentJournalLineSettledInvoices', async () => {
    const { service, d365 } = buildService();
    d365.get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('PaymentJournalLineSettledInvoices')) {
        return { value: [] };
      }
      if (endpoint.includes('CustTransBiEntities')) {
        return {
          value: [
            {
              Invoice: '000009219/Inv-SH',
              DueDate: '2026-01-31T12:00:00Z',
              Closed: '1900-01-01T12:00:00Z',
              AmountCur: 10,
              SettleAmountCur: 0,
              RemainAmountCur: 10,
            },
          ],
        };
      }
      return { value: [] };
    });

    const report = await service.settleFromExcelFiles(
      await enhancedWorkbook(),
      await invoiceWorkbook(),
      { journalBatchNumber: 'Mesco-000015882' },
    );

    expect(d365.post).toHaveBeenCalledTimes(2);
    expect(d365.post.mock.calls[0][0]).toBe(
      '/data/PaymentJournalLineSettledInvoices',
    );
    expect(report.dryRun).toBe(false);
    expect(report.postedCount).toBe(2);
    expect(report.journalBatchNumber).toBe('Mesco-000015882');
  });

  it('uses TRANSDATE from the Shiplink cash-in file when DueDate is missing', async () => {
    const { service, d365 } = buildService();
    const enhanced = await workbookBuffer(
      'Enhanced_source',
      [
        'UniqueId',
        'JournalBatchNumber',
        'LineNumber',
        'Invoice',
        'Company',
        'AccountType',
        'AccountDisplayValue',
        'CreditAmount',
        'Status',
        'Settlement Methode',
      ],
      [
        [
          1,
          'Mesco-000015882',
          1,
          '000009219/Inv-SH',
          'm-p',
          'Cust',
          '101004344',
          2,
          'Ready',
          'Upload',
        ],
        [
          99,
          'Mesco-000015882',
          2,
          '000001277/OF-SH',
          'm-p',
          'Cust',
          '101000001',
          480,
          'Ready',
          'Upload',
        ],
      ],
    );
    const invoices = await workbookBuffer(
      'CashInEntries',
      ['UniqueId', 'INVOICE', 'TRANSDATE', 'CREDITAMOUNT'],
      [[1, '000009219/Inv-SH', '14/01/2026', 2]],
    );

    const report = await service.settleFromExcelFiles(enhanced, invoices, {
      dryRun: true,
    });

    expect(d365.post).not.toHaveBeenCalled();
    expect(report.payloads).toEqual([
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015882',
        JournalLineNumber: 1,
        InvoiceNumber: '000009219/Inv-SH',
        InvoiceCompany: 'm-p',
        InvoiceDueDate: '2026-01-14T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2,
      },
    ]);
    expect(report.skipped.map((row) => row.reason)).toContain(
      'NOT_IN_INVOICE_FILE',
    );
  });
});
