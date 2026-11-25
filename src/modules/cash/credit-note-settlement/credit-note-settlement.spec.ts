import ExcelJS from 'exceljs';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';

import {
  CREDIT_NOTE_SETTLEMENT_HEADERS,
  CREDIT_NOTE_SETTLEMENT_SAFE_TYPE,
  isCreditNoteSettlementEnabled,
} from './credit-note-settlement.constants';
import { buildCreditNoteSettlementLines } from './credit-note-settlement.lines';
import {
  CreditNoteSettlementRow,
  CreditNoteSettlementTemplateError,
  parseCreditNoteSettlementWorkbook,
} from './credit-note-settlement.parser';
import {
  CustTransRow,
  InvoiceHeaderRow,
  reviewCreditNoteSettlements,
} from './credit-note-settlement.review';
import { storedSettlementPairs } from './credit-note-settlement.service';

const DIMENSION =
  '|2401|024|002|018|101000259|101000259|||00002|3171|3171|Payable|||Domestic||||';

async function workbook(
  rows: unknown[][],
  options: { sheet?: string; headers?: readonly string[] } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(options.sheet ?? 'Settlement');
  sheet.addRow([...(options.headers ?? CREDIT_NOTE_SETTLEMENT_HEADERS)]);
  rows.forEach((r) => sheet.addRow(r));
  wb.addWorksheet('How to fill').addRow(['ignored']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const pairRow = [
  'CN-000006072',
  '000000356/YD-CN',
  '101000259',
  -2740,
  'Rev-000335855',
  '000062579/YD',
  2740,
  'EGP',
  2740,
  '',
];

function row(
  overrides: Partial<CreditNoteSettlementRow> = {},
): CreditNoteSettlementRow {
  return {
    sourceRow: 2,
    creditNoteVoucher: 'CN-000006072',
    creditNoteInvoice: '000000356/YD-CN',
    customer: '101000259',
    creditNoteAmount: -2740,
    originalVoucher: 'Rev-000335855',
    originalInvoice: '000062579/YD',
    originalAmount: 2740,
    currency: 'EGP',
    settleAmount: 2740,
    notes: '',
    errors: [],
    ...overrides,
  };
}

function tx(overrides: Partial<CustTransRow> = {}): CustTransRow {
  return {
    Invoice: '000000356/YD-CN',
    OrderAccount: '101000259',
    Voucher: 'CN-000006072',
    AmountCur: -2740,
    AmountMST: -2740,
    SettleAmountCur: 0,
    Closed: '1900-01-01T12:00:00Z',
    CurrencyCode: 'EGP',
    TransDate: '2026-07-19T12:00:00Z',
    ...overrides,
  };
}

const invoiceTx = (overrides: Partial<CustTransRow> = {}) =>
  tx({
    Invoice: '000062579/YD',
    Voucher: 'Rev-000335855',
    AmountCur: 2740,
    AmountMST: 2740,
    ...overrides,
  });

const header: InvoiceHeaderRow = {
  FreeTextNumber: '000062579/YD',
  CustomerAccount: '101000259',
  CurrencyCode: 'EGP',
  DefaultDimensionDisplayValue: DIMENSION,
};

function lookups(cn = tx(), inv = invoiceTx(), headers = [header]) {
  return {
    transactions: new Map([
      ['000000356/YD-CN', [cn]],
      ['000062579/YD', [inv]],
    ]),
    headers: new Map([['000062579/YD', headers]]),
  };
}

describe('credit note settlement template parser', () => {
  it('reads the Settlement sheet and ignores the guide sheet', async () => {
    const result = await parseCreditNoteSettlementWorkbook(
      await workbook([pairRow]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sourceRow: 2,
      creditNoteInvoice: '000000356/YD-CN',
      customer: '101000259',
      originalInvoice: '000062579/YD',
      currency: 'EGP',
      settleAmount: 2740,
      errors: [],
    });
  });

  it('refuses a workbook without the Settlement sheet', async () => {
    await expect(
      parseCreditNoteSettlementWorkbook(
        await workbook([pairRow], { sheet: 'Sheet1' }),
      ),
    ).rejects.toThrow(CreditNoteSettlementTemplateError);
  });

  it('refuses changed headers', async () => {
    const headers = [...CREDIT_NOTE_SETTLEMENT_HEADERS];
    headers[1] = 'Invoice';
    await expect(
      parseCreditNoteSettlementWorkbook(await workbook([pairRow], { headers })),
    ).rejects.toThrow('headers must be exactly');
  });

  it('reports missing values and a non-positive SettleAmount on the row', async () => {
    const bad = [...pairRow];
    bad[1] = '';
    bad[8] = -5;
    const { rows } = await parseCreditNoteSettlementWorkbook(
      await workbook([bad]),
    );
    expect(rows[0].errors).toEqual(
      expect.arrayContaining([
        'CreditNoteInvoice is required',
        'SettleAmount must be a positive amount',
      ]),
    );
  });
});

describe('credit note settlement review', () => {
  it('accepts an open credit note and open invoice for the same customer', () => {
    const [pair] = reviewCreditNoteSettlements([row()], lookups());
    expect(pair.status).toBe('VALID');
    expect(pair.defaultDimension).toBe(DIMENSION);
  });

  it('blocks a closed credit note', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row()],
      lookups(tx({ Closed: '2026-11-01T12:00:00Z' })),
    );
    expect(pair.status).toBe('BLOCKED');
    expect(pair.errors.join(' ')).toContain('already closed');
  });

  it('blocks when the invoice belongs to another customer', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row()],
      lookups(tx(), invoiceTx({ OrderAccount: '101000172' })),
    );
    expect(pair.status).toBe('BLOCKED');
    expect(pair.errors.join(' ')).toContain('belongs to customer 101000172');
  });

  it('blocks a SettleAmount above the open amount', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row({ settleAmount: 3000 })],
      lookups(),
    );
    expect(pair.status).toBe('BLOCKED');
    expect(pair.errors.join(' ')).toContain('more than the open amount');
  });

  it('blocks a second row that would settle the same credit note again', () => {
    const pairs = reviewCreditNoteSettlements(
      [row(), row({ sourceRow: 3 })],
      lookups(),
    );
    expect(pairs[0].status).toBe('VALID');
    expect(pairs[1].status).toBe('BLOCKED');
    expect(pairs[1].errors.join(' ')).toContain('no open amount left');
  });

  it('blocks a voucher that does not match D365', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row({ creditNoteVoucher: 'CN-999' })],
      lookups(),
    );
    expect(pair.errors.join(' ')).toContain('has voucher CN-000006072');
  });

  it('blocks a settlement outside the company currency', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row()],
      lookups(tx({ AmountMST: -5480 })),
    );
    expect(pair.errors.join(' ')).toContain('only company-currency');
  });

  it('blocks an invoice whose header has no default dimension', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row()],
      lookups(tx(), invoiceTx(), [
        { ...header, DefaultDimensionDisplayValue: '' },
      ]),
    );
    expect(pair.errors.join(' ')).toContain('no default dimension');
  });

  it('blocks a row the parser already flagged', () => {
    const [pair] = reviewCreditNoteSettlements(
      [row({ errors: ['Customer is required'] })],
      lookups(),
    );
    expect(pair.status).toBe('BLOCKED');
  });
});

describe('credit note settlement lines', () => {
  it('builds a debit line for the credit note and a credit line for the invoice', () => {
    const pairs = reviewCreditNoteSettlements([row()], lookups());
    const lines = buildCreditNoteSettlementLines(pairs, 'm-p', '2026-11-25');
    expect(lines).toHaveLength(2);
    const [debit, credit] = lines;
    expect(debit).toMatchObject({
      AccountType: 'Cust',
      AccountDisplayValue: '101000259',
      DebitAmount: 2740,
      CreditAmount: 0,
      OffsetAccountType: '',
      OffsetAccountDisplayValue: '',
      SafeType: CREDIT_NOTE_SETTLEMENT_SAFE_TYPE,
      SourceLineNumber: 2,
      JournalName: 'Cust-Pay',
    });
    expect(debit.MarkedLines[0].InvoiceNumber).toBe('000000356/YD-CN');
    expect(credit).toMatchObject({ DebitAmount: 0, CreditAmount: 2740 });
    expect(credit.MarkedLines[0].InvoiceNumber).toBe('000062579/YD');
    expect(debit.ErrorCount).toBe(0);
    expect(credit.ErrorCount).toBe(0);
    expect(debit.DefaultDimensionsForAccountDisplayValue).toContain('2401');
  });

  it('stores a blocked pair as one line that carries its errors', () => {
    const pairs = reviewCreditNoteSettlements(
      [row({ settleAmount: 9999 })],
      lookups(),
    );
    const lines = buildCreditNoteSettlementLines(pairs, 'm-p', '2026-11-25');
    expect(lines).toHaveLength(1);
    expect(lines[0].ErrorCount).toBeGreaterThan(0);
    expect(lines[0].GetErrors().join(' ')).toContain('Row 2');
  });

  it('rebuilds the stored pairs for the pre-post check', () => {
    const pairs = reviewCreditNoteSettlements([row()], lookups());
    const lines = buildCreditNoteSettlementLines(pairs, 'm-p', '2026-11-25');
    expect(storedSettlementPairs(lines)).toEqual([
      {
        sourceRow: 2,
        customer: '101000259',
        creditNoteInvoice: '000000356/YD-CN',
        originalInvoice: '000062579/YD',
        currency: 'EGP',
        amount: 2740,
      },
    ]);
  });
});

describe('credit note settlement posting map', () => {

  it('sends both lines without offset fields, with the invoice marks, and passes line validation', () => {
    const handler = new PostCashBatchToDFOHandler(
      {} as never,
      {} as never,
      new CashJournalRoutingService(),
    ) as unknown as {
      mapLines: (...args: unknown[]) => Array<{
        creditNoteSettlement?: boolean;
        customLineApiBody: Record<string, unknown> & {
          MarkedLines: Array<{ InvoiceNumber: string }>;
        };
      }>;
      validateLine: (line: unknown) => string[];
    };
    const pairs = reviewCreditNoteSettlements([row()], lookups());
    const lines = buildCreditNoteSettlementLines(pairs, 'm-p', '2026-11-25');
    const mapped = handler.mapLines(
      lines.map((data) => ({ data })),
      'm-p',
      'in',
      undefined,
      false,
    );
    expect(mapped).toHaveLength(2);
    for (const line of mapped) {
      expect(line.creditNoteSettlement).toBe(true);
      expect(
        Object.keys(line.customLineApiBody).filter((k) =>
          k.toLowerCase().startsWith('offset'),
        ),
      ).toEqual([]);
      expect(handler.validateLine(line)).toEqual([]);
    }
    expect(mapped[0].customLineApiBody.debitAmount).toBe(2740);
    expect(mapped[0].customLineApiBody.MarkedLines[0].InvoiceNumber).toBe(
      '000000356/YD-CN',
    );
    expect(mapped[1].customLineApiBody.creditAmount).toBe(2740);
    expect(mapped[1].customLineApiBody.MarkedLines[0].InvoiceNumber).toBe(
      '000062579/YD',
    );
  });
});

describe('credit note settlement flag', () => {
  it('is on only for true, 1 or yes', () => {
    expect(
      isCreditNoteSettlementEnabled({ CREDIT_NOTE_SETTLEMENT_ENABLED: 'true' }),
    ).toBe(true);
    expect(isCreditNoteSettlementEnabled({})).toBe(false);
  });
});
