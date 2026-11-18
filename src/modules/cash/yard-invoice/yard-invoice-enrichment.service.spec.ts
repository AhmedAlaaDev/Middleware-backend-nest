import { YardInvoiceEnrichmentService } from './yard-invoice-enrichment.service';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

type Row = Record<string, unknown>;
type Dataset = Record<string, Row[]>;

/**
 * Filter-aware fake of the D365 read path. It evaluates the `$filter` that the
 * service sends (eq clauses, `and`, and parenthesised `or` groups) against
 * synthetic rows, so the tests check what the service asks for, not only how
 * often it asks.
 */
function fakeD365(dataset: Dataset, options: { failEntity?: string } = {}) {
  const calls: string[] = [];
  const get = jest.fn((endpoint: string) => {
    calls.push(endpoint);
    const entity = Object.keys(dataset).find((key) =>
      endpoint.startsWith(`/data/${key}`),
    );
    if (!entity)
      return Promise.reject(new Error(`unexpected endpoint ${endpoint}`));
    if (options.failEntity === entity)
      return Promise.reject(new Error('503 from D365'));
    const url = new URL(`http://d365.test${endpoint}`);
    const filter = url.searchParams.get('$filter') ?? '';
    const rows = dataset[entity].filter((row) => evaluate(filter, row));
    return Promise.resolve({ value: rows });
  });
  return { client: { get } as unknown as D365FOClientService, get, calls };
}

function evaluate(expression: string, row: Row): boolean {
  const clauses = splitTop(expression, 'and');
  return clauses.every((clause) => {
    const trimmed = clause.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      return splitTop(trimmed.slice(1, -1), 'or').some((part) =>
        evaluateEq(part.trim(), row),
      );
    }
    return evaluateEq(trimmed, row);
  });
}

function evaluateEq(clause: string, row: Row): boolean {
  const match = /^(\w+) eq (?:'((?:[^']|'')*)'|(-?\d+))$/.exec(clause);
  if (!match) throw new Error(`unsupported filter clause: ${clause}`);
  const [, field, quoted, numeric] = match;
  const expected = quoted !== undefined ? quoted.replace(/''/g, "'") : numeric;
  const actual = row[field];
  if (actual === undefined || actual === null) return false;
  const text = typeof actual === 'string' || typeof actual === 'number' ? String(actual) : '';
  return text === expected;
}

/** Splits on a top-level keyword, ignoring keywords inside parentheses or quotes. */
function splitTop(expression: string, keyword: 'and' | 'or'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  const token = ` ${keyword} `;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && expression.startsWith(token, i)) {
      parts.push(current);
      current = '';
      i += token.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

let entrySeq = 100000;

const COMPANY = 'm-p';

function invoiceFixture(
  number: string,
  overrides: {
    customer?: string;
    tag?: string;
    receivableTags?: number[];
    amount?: string;
  } = {},
) {
  const customer = overrides.customer ?? 'C-100';
  const entryKey = String(++entrySeq); // Int64 keys are numeric in D365
  const tagIds = overrides.receivableTags ?? [555];
  return {
    header: {
      dataAreaId: COMPANY,
      InvoiceIdentifier: 1000 + number.length,
      FreeTextNumber: number,
      IsPosted: 'Yes',
      CustomerAccount: customer,
      CurrencyCode: 'EGP',
      DefaultDimensionDisplayValue: '|2401|024',
    },
    trans: {
      dataAreaId: COMPANY,
      SourceKey: 9000,
      Invoice: number,
      Voucher: `V-${number}`,
      AccountNum: customer,
      CurrencyCode: 'EGP',
      AmountCur: overrides.amount ?? '1350.0001',
      SettleAmountCur: 0,
      Closed: '1900-01-01T00:00:00Z',
    },
    gl: {
      dataAreaId: COMPANY,
      SourceKey: entryKey,
      SubledgerVoucher: `V-${number}`,
      SubledgerVoucherDataAreaId: COMPANY,
    },
    lines: tagIds.map((tag) => ({
      GeneralJournalEntry: entryKey,
      PostingType: 'CustBalance',
      IsCredit: false,
      FinTag: tag,
    })),
  };
}

function datasetFor(fixtures: ReturnType<typeof invoiceFixture>[]): Dataset {
  return {
    FreeTextInvoiceHeaders: fixtures.map((f) => f.header),
    CustTransBiEntities: fixtures.map((f) => f.trans),
    GeneralJournalEntryBiEntities: fixtures.map((f) => f.gl),
    GeneralJournalAccountEntryBiEntities: fixtures.flatMap((f) => f.lines),
    FinTageBiEntities: [
      { SourceKey: 555, DisplayValue: 'MSC LINE|MSNU7435730' },
      { SourceKey: 556, DisplayValue: 'OTHER TAG' },
    ],
  };
}

function service(dataset: Dataset, options: { failEntity?: string } = {}) {
  const fake = fakeD365(dataset, options);
  return {
    ...fake,
    service: new YardInvoiceEnrichmentService(
      fake.client,
      new ODataQueryBuilderService(),
    ),
  };
}

describe('YardInvoiceEnrichmentService (batched)', () => {
  it('resolves customer, currency, dimensions, tag and open balance for several invoices', async () => {
    const { service: svc } = service(
      datasetFor([invoiceFixture('INV-A'), invoiceFixture('INV-B')]),
    );
    const results = await svc.resolveInvoices(COMPANY, ['INV-A', 'INV-B']);
    const a = results.get('INV-A');
    expect(a).toMatchObject({ status: 'FOUND' });
    if (a?.status !== 'FOUND') return;
    expect(a.metadata).toMatchObject({
      customerAccount: 'C-100',
      currencyCode: 'EGP',
      defaultDimensionDisplayValue: '|2401|024',
      financialTagDisplayValue: 'MSC LINE|MSNU7435730',
      voucher: 'V-INV-A',
    });
    expect(a.metadata.openBalance).toBe(1350000100n);
  });

  it('batches many invoices into few requests (40 keys per request)', async () => {
    const numbers = Array.from(
      { length: 100 },
      (_, i) => `INV-${String(i).padStart(3, '0')}`,
    );
    const { service: svc, calls } = service(
      datasetFor(numbers.map((n) => invoiceFixture(n))),
    );
    const results = await svc.resolveInvoices(COMPANY, numbers);
    expect([...results.values()].every((r) => r.status === 'FOUND')).toBe(true);
    const headerCalls = calls.filter((c) =>
      c.includes('/data/FreeTextInvoiceHeaders'),
    );
    expect(headerCalls).toHaveLength(3); // 100 invoices / 40 per chunk
    expect(calls.length).toBeLessThan(40); // far fewer than one request per invoice
  });

  it('parenthesises every OR group so it binds after the company filter', async () => {
    const { service: svc, calls } = service(
      datasetFor([invoiceFixture('INV-A')]),
    );
    await svc.resolveInvoices(COMPANY, ['INV-A']);
    for (const endpoint of calls) {
      const filter =
        new URL(`http://d365.test${endpoint}`).searchParams.get('$filter') ??
        '';
      if (filter.includes(' or ')) {
        expect(filter).toMatch(/\(.* or .*\)/);
      }
    }
  });

  it('sends Int64 keys unquoted and string keys quoted', async () => {
    const { service: svc, calls } = service(
      datasetFor([invoiceFixture('INV-A')]),
    );
    await svc.resolveInvoices(COMPANY, ['INV-A']);
    const glAccount = calls.find((c) =>
      c.includes('/data/GeneralJournalAccountEntryBiEntities'),
    );
    const filter =
      new URL(`http://d365.test${glAccount}`).searchParams.get('$filter') ?? '';
    expect(filter).toMatch(/GeneralJournalEntry eq [^']/);
    const tag = calls.find((c) => c.includes('/data/FinTageBiEntities'));
    expect(
      new URL(`http://d365.test${tag}`).searchParams.get('$filter'),
    ).toMatch(/SourceKey eq 555/);
  });

  it('returns NOT_FOUND when no header exists in the company', async () => {
    const { service: svc } = service(datasetFor([]));
    expect(
      (await svc.resolveInvoices(COMPANY, ['MISSING'])).get('MISSING'),
    ).toMatchObject({ status: 'NOT_FOUND' });
  });

  it('returns AMBIGUOUS when two headers match the same number', async () => {
    const dataset = datasetFor([invoiceFixture('INV-A')]);
    dataset.FreeTextInvoiceHeaders.push({
      ...invoiceFixture('INV-A').header,
      InvoiceIdentifier: 2,
    });
    const { service: svc } = service(dataset);
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'AMBIGUOUS' });
  });

  it('returns NOT_POSTED for an unposted header', async () => {
    const fixture = invoiceFixture('INV-A');
    fixture.header.IsPosted = 'No';
    const { service: svc } = service(datasetFor([fixture]));
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'NOT_POSTED' });
  });

  it('returns MISSING_DIMENSION when the header has no default dimensions', async () => {
    const fixture = invoiceFixture('INV-A');
    fixture.header.DefaultDimensionDisplayValue = '';
    const { service: svc } = service(datasetFor([fixture]));
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'MISSING_DIMENSION' });
  });

  it('returns CUSTOMER_MISMATCH when the posted transaction belongs to another account', async () => {
    const fixture = invoiceFixture('INV-A');
    fixture.trans.AccountNum = 'C-999';
    const { service: svc } = service(datasetFor([fixture]));
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'CUSTOMER_MISMATCH' });
  });

  it('returns CLOSED for a settled invoice (closed date, not the 1900 sentinel)', async () => {
    const fixture = invoiceFixture('INV-A');
    fixture.trans.Closed = '2026-08-01T00:00:00Z';
    const { service: svc } = service(datasetFor([fixture]));
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'CLOSED' });
  });

  it('subtracts settled amounts from the open balance', async () => {
    const fixture = invoiceFixture('INV-A');
    fixture.trans.SettleAmountCur = -100.5;
    const { service: svc } = service(datasetFor([fixture]));
    const result = await svc.resolveInvoices(COMPANY, ['INV-A']);
    const found = result.get('INV-A');
    expect(found?.status === 'FOUND' && found.metadata.openBalance).toBe(
      1249500100n,
    );
  });

  it('returns AMBIGUOUS when one voucher is shared by two invoices', async () => {
    const a = invoiceFixture('INV-A');
    const b = invoiceFixture('INV-B');
    b.trans.Voucher = a.trans.Voucher;
    const { service: svc } = service(datasetFor([a, b]));
    const results = await svc.resolveInvoices(COMPANY, ['INV-A', 'INV-B']);
    expect(results.get('INV-A')).toMatchObject({ status: 'AMBIGUOUS' });
    expect(results.get('INV-B')).toMatchObject({ status: 'AMBIGUOUS' });
  });

  it('returns MISSING_TAG when the receivable line has tag 0', async () => {
    const { service: svc } = service(
      datasetFor([invoiceFixture('INV-A', { receivableTags: [0] })]),
    );
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'MISSING_TAG' });
  });

  it('returns AMBIGUOUS when receivable lines carry different tags', async () => {
    const { service: svc } = service(
      datasetFor([invoiceFixture('INV-A', { receivableTags: [555, 556] })]),
    );
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'AMBIGUOUS' });
  });

  it('returns MISSING_TAG when the tag display value cannot be resolved', async () => {
    const dataset = datasetFor([
      invoiceFixture('INV-A', { receivableTags: [777] }),
    ]);
    const { service: svc } = service(dataset);
    expect(
      (await svc.resolveInvoices(COMPANY, ['INV-A'])).get('INV-A'),
    ).toMatchObject({ status: 'MISSING_TAG' });
  });

  it('isolates a failed chunk: its invoices are LOOKUP_FAILED (retryable), the rest still resolve', async () => {
    const dataset = datasetFor([invoiceFixture('INV-A')]);
    const { service: svc } = service(dataset, {
      failEntity: 'CustTransBiEntities',
    });
    const result = await svc.resolveInvoices(COMPANY, ['INV-A']);
    expect(result.get('INV-A')).toMatchObject({
      status: 'LOOKUP_FAILED',
      retryable: true,
    });
  });

  it('keeps one result per distinct invoice number', async () => {
    const { service: svc, get } = service(
      datasetFor([invoiceFixture('INV-A')]),
    );
    const results = await svc.resolveInvoices(COMPANY, ['INV-A', 'INV-A']);
    expect([...results.keys()]).toEqual(['INV-A']);
    expect(
      get.mock.calls.filter((c) =>
        String(c[0]).includes('FreeTextInvoiceHeaders'),
      ),
    ).toHaveLength(1);
  });
});
