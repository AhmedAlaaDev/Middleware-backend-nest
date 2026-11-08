import { ODataQueryBuilderService } from './odata-query-builder.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

/**
 * Settlement side of native withholding. The vendor line is NET; the invoice
 * mark covers net + withholding; D365's withholding calculation is enabled on
 * the REAL resolved D365 line (never the planned number) and read back. The
 * line is updated through CalculateWithholdingTax and TaxWithholdGroup only:
 * D365 refuses OData updates of ItemWithholdingTaxGroupCode (verified). A
 * failure to enable it is raised, never skipped, because no explicit 223304
 * entry exists any more. D365 is fully mocked.
 */
const OPEN = '1900-01-01T12:00:00Z';
const DUE = '2026-09-30T12:00:00Z';

interface Line {
  LineNumber: number;
  PaymentId: string;
  AccountDisplayValue: string;
  CurrencyCode: string;
  DebitAmount: number;
  CreditAmount: number;
  CalculateWithholdingTax: string;
  TaxWithholdGroup: string;
}

const vendorLine = (
  LineNumber: number,
  PaymentId: string,
  DebitAmount: number,
  extra: Partial<Line> = {},
): Line => ({
  LineNumber,
  PaymentId,
  AccountDisplayValue: 'Sl-000036',
  CurrencyCode: 'USD',
  DebitAmount,
  CreditAmount: 0,
  CalculateWithholdingTax: 'No',
  TaxWithholdGroup: '',
  ...extra,
});
const custodyLine = (
  LineNumber: number,
  PaymentId: string,
  CreditAmount: number,
): Line => ({
  LineNumber,
  PaymentId,
  AccountDisplayValue: '3210',
  CurrencyCode: 'USD',
  DebitAmount: 0,
  CreditAmount,
  CalculateWithholdingTax: 'No',
  TaxWithholdGroup: '',
});
const trans = (Invoice: string, amount: number, settled = 0) => ({
  Invoice,
  AccountNum: 'Sl-000036',
  CurrencyCode: 'USD',
  Closed: OPEN,
  AmountCur: -amount,
  SettleAmountCur: settled,
  DocumentNum: '25544',
  DueDate: DUE,
});
const target = (
  lineNumber: number,
  uniqueId: string,
  invoiceNumber: string,
  debitAmount: number,
  withholdingAmount?: number,
) => ({
  lineNumber,
  uniqueId,
  vendorAccount: 'Sl-000036',
  currencyCode: 'USD',
  debitAmount,
  creditAmount: 0,
  invoiceNumber,
  documentNumber: '25544',
  ...(withholdingAmount
    ? { withholdingAmount, withholdingGroup: 'WHT-3%' }
    : {}),
});

function harness(options: {
  lines: Line[];
  vendTrans: object[];
  settled?: object[];
  patch?: 'apply' | 'reject' | 'ignore';
  /** D365 stores this amount instead of the one sent (read-back test). */
  storedMarkAmount?: number;
}) {
  const settled: any[] = [...(options.settled ?? [])];
  const client = {
    get: jest.fn((url: string) => {
      const decoded = decodeURIComponent(url);
      if (url.startsWith('/data/VendorPaymentJournalLines?')) {
        const wanted = decoded.match(/LineNumber eq (\d+)/);
        return Promise.resolve({
          value: wanted
            ? options.lines.filter((l) => l.LineNumber === Number(wanted[1]))
            : options.lines,
        });
      }
      if (url.startsWith('/data/VendorPaymentJournalLineSettledInvoices')) {
        return Promise.resolve({ value: settled });
      }
      if (url.startsWith('/data/VendTransBiEntities')) {
        return Promise.resolve({
          value: options.vendTrans.filter((row: any) =>
            decoded.includes(`Invoice eq '${row.Invoice}'`),
          ),
        });
      }
      return Promise.resolve({ value: [] });
    }),
    post: jest.fn((_url: string, body: any) => {
      settled.push({
        ...body,
        invoiceAccount: 'Sl-000036',
        ...(options.storedMarkAmount !== undefined
          ? { SettlementAmountInInvoiceCurrency: options.storedMarkAmount }
          : {}),
      });
      return Promise.resolve({});
    }),
    patch: jest.fn((endpoint: string, body: any) => {
      if (options.patch === 'reject') {
        return Promise.reject(new Error('Infolog: item group is not valid'));
      }
      if (options.patch !== 'ignore') {
        const lineNumber = Number(endpoint.match(/LineNumber=(\d+)/)?.[1]);
        const row = options.lines.find((l) => l.LineNumber === lineNumber);
        if (row) Object.assign(row, body);
      }
      return Promise.resolve({});
    }),
  };
  const service = new VendorInvoiceJournalService(
    client as any,
    new ODataQueryBuilderService(),
    {} as any,
    {} as any,
  );
  const run = (targets: any[], continueOnError = false, skipped: any[] = []) =>
    service.createVendorPaymentJournalLineSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000019377',
      targets,
      continueOnError,
      skipped,
    });
  const posted = () =>
    client.post.mock.calls.map(([, b]: any) => [
      b.JournalLineNumber,
      b.InvoiceNumber,
      b.SettlementAmountInInvoiceCurrency,
    ]);
  return { client, run, posted, settled, lines: options.lines };
}

describe('native withholding settlement', () => {
  const journal = () => [
    custodyLine(180, 'P1', 2201.13),
    vendorLine(182, 'P1', 2201.13),
  ];

  it('enables withholding on the real line and marks the invoice for the gross amount', async () => {
    const { run, client, posted, lines } = harness({
      lines: journal(),
      vendTrans: [trans('5815410364', 2260.62)],
    });

    // Planned line 99 is not an identity: the real line is 182.
    await run([target(99, 'P1', '5815410364', 2201.13, 59.49)]);

    expect(client.patch).toHaveBeenCalledTimes(1);
    expect(client.patch.mock.calls[0][0]).toContain('LineNumber=182');
    expect(client.patch.mock.calls[0][1]).toEqual({
      CalculateWithholdingTax: 'Yes',
      TaxWithholdGroup: 'WHT-3%',
    });
    expect(lines.find((l) => l.LineNumber === 182)).toMatchObject({
      CalculateWithholdingTax: 'Yes',
      TaxWithholdGroup: 'WHT-3%',
    });
    expect(lines.find((l) => l.LineNumber === 180)?.CalculateWithholdingTax).toBe(
      'No',
    );
    expect(posted()).toEqual([[182, '5815410364', -2260.62]]);
  });

  it('settles a partial gross amount and rejects a genuine over-settlement', async () => {
    const partial = harness({
      lines: journal(),
      vendTrans: [trans('INV', 5000, 1000)],
    });
    await partial.run([target(1, 'P1', 'INV', 2201.13, 59.49)]);
    expect(partial.posted()).toEqual([[182, 'INV', -2260.62]]);

    const over = harness({
      lines: journal(),
      vendTrans: [trans('INV', 2260.6)],
    });
    const skipped: any[] = [];
    await over.run([target(1, 'P1', 'INV', 2201.13, 59.49)], true, skipped);
    expect(over.client.post).not.toHaveBeenCalled();
    expect(skipped[0].error).toContain('[SETTLEMENT_AMOUNT_INVALID]');
  });

  it('adds the withholding in whole cents for 4-decimal source amounts', async () => {
    const { run, posted } = harness({
      lines: [vendorLine(297, 'P3', 1539.01)],
      vendTrans: [trans('5815412371', 1580.6)],
    });
    await run([target(1, 'P3', '5815412371', 1539.0086, 41.59)]);
    expect(posted()).toEqual([[297, '5815412371', -1580.6]]);
  });

  it('leaves a transaction without withholding exactly as before', async () => {
    const { run, client, posted } = harness({
      lines: journal(),
      vendTrans: [trans('INV', 2201.13)],
    });
    await run([target(1, 'P1', 'INV', 2201.13)]);
    expect(client.patch).not.toHaveBeenCalled();
    expect(posted()).toEqual([[182, 'INV', -2201.13]]);
  });

  it('is idempotent: an enabled line and a correct gross mark are left alone', async () => {
    const { run, client } = harness({
      lines: [
        vendorLine(182, 'P1', 2201.13, {
          CalculateWithholdingTax: 'Yes',
          TaxWithholdGroup: 'WHT-3%',
        }),
      ],
      vendTrans: [trans('5815410364', 2260.62)],
      settled: [
        {
          JournalLineNumber: 182,
          InvoiceNumber: '5815410364',
          invoiceAccount: 'Sl-000036',
          SettlementAmountInInvoiceCurrency: -2260.62,
        },
      ],
    });
    await run([target(1, 'P1', '5815410364', 2201.13, 59.49)]);
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('keeps equal-amount payments of one vendor on their own lines', async () => {
    const { run, client, posted } = harness({
      lines: [vendorLine(10, 'A', 2201.13), vendorLine(12, 'B', 2201.13)],
      vendTrans: [trans('INV-A', 2260.62), trans('INV-B', 2260.62)],
    });
    await run([
      target(99, 'B', 'INV-B', 2201.13, 59.49),
      target(98, 'A', 'INV-A', 2201.13, 59.49),
    ]);
    expect(
      client.patch.mock.calls.map(([e]: any) => e.match(/LineNumber=(\d+)/)[1]).sort(),
    ).toEqual(['10', '12']);
    expect(posted().sort()).toEqual([
      [10, 'INV-A', -2260.62],
      [12, 'INV-B', -2260.62],
    ]);
  });

  it('retrying after an interruption enables only what is missing', async () => {
    const { run, client, posted } = harness({
      lines: [
        vendorLine(10, 'A', 2201.13, {
          CalculateWithholdingTax: 'Yes',
          TaxWithholdGroup: 'WHT-3%',
        }),
        vendorLine(12, 'B', 2201.13),
      ],
      vendTrans: [trans('INV-A', 2260.62), trans('INV-B', 2260.62)],
      settled: [
        {
          JournalLineNumber: 10,
          InvoiceNumber: 'INV-A',
          invoiceAccount: 'Sl-000036',
          SettlementAmountInInvoiceCurrency: -2260.62,
        },
      ],
    });
    await run([
      target(1, 'A', 'INV-A', 2201.13, 59.49),
      target(2, 'B', 'INV-B', 2201.13, 59.49),
    ]);
    expect(client.patch).toHaveBeenCalledTimes(1);
    expect(client.patch.mock.calls[0][0]).toContain('LineNumber=12');
    expect(posted()).toEqual([[12, 'INV-B', -2260.62]]);
  });
});

describe('native withholding failures are never skipped', () => {
  const lines = () => [vendorLine(182, 'P1', 2201.13)];
  const trn = () => [trans('5815410364', 2260.62)];

  it('raises when D365 rejects the group, even in skip-and-report mode', async () => {
    const { run, client } = harness({
      lines: lines(),
      vendTrans: trn(),
      patch: 'reject',
    });
    const skipped: any[] = [];
    await expect(
      run([target(1, 'P1', '5815410364', 2201.13, 59.49)], true, skipped),
    ).rejects.toThrow('[WITHHOLDING_NOT_ENABLED]');
    expect(client.post).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(0);
  });

  it('raises when the read-back does not show the calculation enabled', async () => {
    const { run, client } = harness({
      lines: lines(),
      vendTrans: trn(),
      patch: 'ignore',
    });
    await expect(
      run([target(1, 'P1', '5815410364', 2201.13, 59.49)], true),
    ).rejects.toThrow('Read-back shows native withholding');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('does not report success when D365 stores a different mark amount than the gross sent', async () => {
    const { run } = harness({
      lines: lines(),
      vendTrans: trn(),
      storedMarkAmount: -2201.13, // net only: the withholding portion is missing
    });
    const skipped: any[] = [];
    await run([target(1, 'P1', '5815410364', 2201.13, 59.49)], true, skipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('[SETTLEMENT_VERIFICATION_FAILED]');
  });

  it('raises when no withholding group is available', async () => {
    const { run, client } = harness({ lines: lines(), vendTrans: trn() });
    await expect(
      run([
        {
          ...target(1, 'P1', '5815410364', 2201.13, 59.49),
          withholdingGroup: '',
        },
      ]),
    ).rejects.toThrow('No withholding group');
    expect(client.patch).not.toHaveBeenCalled();
  });
});
