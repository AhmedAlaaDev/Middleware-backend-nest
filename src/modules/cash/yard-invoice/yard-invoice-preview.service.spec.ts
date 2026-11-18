import {
  YardInvoiceAccountResolver,
  YardOffsetAccountResolution,
  offsetRequestKey,
} from './yard-invoice-account.resolver';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { YardInvoiceEnrichmentService } from './yard-invoice-enrichment.service';
import { YardInvoiceLookupResult } from './yard-invoice-lookup.types';
import {
  hashPayload,
  isYardInvoiceUploadEnabled,
  YardInvoicePreviewService,
} from './yard-invoice-preview.service';
import { YardInvoiceTemplateError } from './yard-invoice-template.parser';
import {
  baseRow,
  buildTemplateWorkbook,
  buildYardsSourceWorkbook,
  yardsRow,
} from './yard-invoice.test-helpers';

const ACCOUNT_OK: YardOffsetAccountResolution = {
  status: 'OK',
  accountType: 'Petty cash',
  accountDisplayValue: 'Yard Safe',
  message: '',
  retryable: false,
};

const YARDS_DIMENSION =
  '|2401|024|002|012|101000262|101000262|||00002|3171|3171|Payable|||Domestic||||';
const YARDS_TAG = '||MSC LINE|||MSNU7435730|0     ';

function foundResult(
  invoiceNumber: string,
  overrides: { customer?: string; tag?: string; dimension?: string } = {},
): YardInvoiceLookupResult {
  return {
    status: 'FOUND',
    metadata: {
      invoiceNumber,
      company: 'm-p',
      invoiceIdentifier: '1',
      customerAccount: overrides.customer ?? 'C-100',
      currencyCode: 'EGP',
      defaultDimensionDisplayValue: overrides.dimension ?? '|2401|024',
      financialTagDisplayValue: overrides.tag ?? 'TAG-A',
      voucher: 'V-1',
      openBalance: parseDecimalToMicro('10000.00'),
    },
  };
}

function build(
  lookups: Map<string, YardInvoiceLookupResult> = new Map(),
  accountFor: (paymentType: string) => YardOffsetAccountResolution = () =>
    ACCOUNT_OK,
) {
  const resolveInvoices = jest.fn((_company: string, invoices: string[]) => {
    const map = new Map<string, YardInvoiceLookupResult>();
    for (const invoice of invoices)
      map.set(invoice, lookups.get(invoice) ?? foundResult(invoice));
    return Promise.resolve(map);
  });
  const resolveMany = jest.fn(
    (_company: string, requests: Parameters<typeof offsetRequestKey>[0][]) => {
      const map = new Map<string, YardOffsetAccountResolution>();
      for (const request of requests)
        map.set(offsetRequestKey(request), accountFor(request.paymentType));
      return Promise.resolve(map);
    },
  );
  const enrichment = {
    resolveInvoices,
  } as unknown as YardInvoiceEnrichmentService;
  const accounts = { resolveMany } as unknown as YardInvoiceAccountResolver;
  return {
    service: new YardInvoicePreviewService(enrichment, accounts),
    resolveInvoices,
    resolveMany,
  };
}

describe('YardInvoicePreviewService.review (eight-column template)', () => {
  it('consolidates the template, resolves D365 values and the account, and is submittable', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({
        PaymentSerial: 'PS-1',
        'PaymentNet Total': '1350.0001',
        InvoiceNumber: '000061156/YD',
      }),
      baseRow({
        PaymentSerial: 'PS-2',
        'PaymentNet Total': '100',
        InvoiceNumber: '000061156/YD',
      }),
      baseRow({
        PaymentSerial: 'PS-3',
        'PaymentNet Total': '50',
        InvoiceNumber: '000061157/YD',
      }),
    ]);
    const { service, resolveInvoices, resolveMany } = build();
    const review = await service.review({
      fileBuffer: buffer,
      fileName: 'template.xlsx',
      companyId: 'm-p',
    });
    const summary = service.toSummary(review);
    expect(review.format).toBe('TEMPLATE_8');
    expect(resolveInvoices).toHaveBeenCalledWith('m-p', [
      '000061156/YD',
      '000061157/YD',
    ]);
    expect(resolveMany).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      format: 'TEMPLATE_8',
      recordCount: 3,
      distinctInvoiceCount: 2,
      blockedInvoiceCount: 0,
      canSubmit: true,
    });
    expect(summary.currencyTotals).toEqual([
      expect.objectContaining({
        currencyCode: 'EGP',
        invoiceCount: 2,
        rawTotal: '1500.0001',
        roundedTotal: '1500.00',
        roundingChange: '-0.0001',
      }),
    ]);
    expect(service.toPostingInputs(review)).toHaveLength(2);
  });

  it('does not look up invoices whose group is already rejected by aggregation', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ InvoiceNumber: 'ABC/YD', PaymentSerial: 'PS-1' }),
      baseRow({ InvoiceNumber: 'abc/yd', PaymentSerial: 'PS-2' }),
      baseRow({ InvoiceNumber: 'OK/YD', PaymentSerial: 'PS-3' }),
    ]);
    const { service, resolveInvoices } = build();
    const review = await service.review({
      fileBuffer: buffer,
      fileName: 'f.xlsx',
      companyId: 'm-p',
    });
    expect(resolveInvoices).toHaveBeenCalledWith('m-p', ['OK/YD']);
    expect(service.toSummary(review).canSubmit).toBe(false);
    expect(service.toSummary(review).aggregationIssueCount).toBe(2);
    expect(() => service.toPostingInputs(review)).toThrow(/not submittable/);
  });

  it('rejects a structurally wrong workbook before any D365 call', async () => {
    const buffer = await buildTemplateWorkbook([baseRow()], {
      sheetName: 'Wrong',
    });
    const { service, resolveInvoices } = build();
    await expect(
      service.review({ fileBuffer: buffer, fileName: 'x', companyId: 'm-p' }),
    ).rejects.toThrow(YardInvoiceTemplateError);
    expect(resolveInvoices).not.toHaveBeenCalled();
  });

  it('keeps the payload hash stable for identical content and changes it when the amount changes', async () => {
    const { service } = build();
    const a = await buildTemplateWorkbook([
      baseRow({ 'PaymentNet Total': '100' }),
    ]);
    const b = await buildTemplateWorkbook([
      baseRow({ 'PaymentNet Total': '100' }),
    ]);
    const c = await buildTemplateWorkbook([
      baseRow({ 'PaymentNet Total': '101' }),
    ]);
    const r1 = await service.review({
      fileBuffer: a,
      fileName: 'x',
      companyId: 'm-p',
    });
    const r2 = await service.review({
      fileBuffer: b,
      fileName: 'x',
      companyId: 'm-p',
    });
    const r3 = await service.review({
      fileBuffer: c,
      fileName: 'x',
      companyId: 'm-p',
    });
    expect(r1.payloadHash).toBe(r2.payloadHash);
    expect(r1.payloadHash).not.toBe(r3.payloadHash);
  });

  it('changes the payload hash when D365 metadata or the offset account changes', () => {
    const groups = [
      {
        invoiceNumber: 'INV-1',
        currencyCode: 'EGP',
        paymentType: 'Cash',
        safeBankAccount: 'Safe A',
        paymentDate: '2026-07-15',
        paymentReference: '',
        sources: [
          {
            sourceSheet: 'Template',
            sourceRow: 2,
            paymentSerial: 'PS-1',
            amountText: '100',
          },
        ],
        roundedTotalText: '100.00',
      },
    ] as unknown as Parameters<typeof hashPayload>[1];
    const check = (tag: string, accountType: 'Petty cash' | 'Bank') => ({
      invoiceNumber: 'INV-1',
      status: 'VALID' as const,
      errors: [],
      warnings: [],
      metadata: {
        customerAccount: 'C-1',
        defaultDimensionDisplayValue: '|1',
        financialTagDisplayValue: tag,
        voucher: 'V',
      },
      offsetAccount: { ...ACCOUNT_OK, accountType },
      expectedOpenBalanceText: null,
      submittedTotalText: '100.00',
    });
    const base = hashPayload('m-p', groups, [
      check('TAG-A', 'Petty cash'),
    ] as never);
    expect(
      hashPayload('m-p', groups, [check('TAG-B', 'Petty cash')] as never),
    ).not.toBe(base);
    expect(
      hashPayload('m-p', groups, [check('TAG-A', 'Bank')] as never),
    ).not.toBe(base);
    expect(
      hashPayload('m-p', groups, [check('TAG-A', 'Petty cash')] as never),
    ).toBe(base);
  });
});

describe('YardInvoicePreviewService.review (Yards source workbook)', () => {
  it('reviews a multi-sheet Yards workbook: lineage kept, workbook values compared with D365, CN blocks', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: '10-YARD-IST',
        layoutId: 'YARDS_LAYOUT_IST',
        rows: [
          yardsRow({
            FREETEXTNUMBER: '000061184/YD',
            CUSTOMERACCOUNT: 'C-100',
            Customer: 'Synthetic',
          }),
        ],
      },
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [
          yardsRow({
            FREETEXTNUMBER: '000061195/YD',
            CUSTOMERACCOUNT: 'C-999',
            DEFAULTDIMENSIONDISPLAYVALUE: '|2401|024|002|019|C-999|C-999',
          }),
        ],
      },
      {
        name: 'yard.',
        layoutId: 'YARDS_LAYOUT_REMARK',
        rows: [
          yardsRow({
            FREETEXTNUMBER: '000000356/YD-CN',
            'Net Total': -2740,
            'Payment Type': 'CASH',
          }),
        ],
      },
    ]);
    const agrees = {
      customer: 'C-100',
      dimension: YARDS_DIMENSION,
      tag: YARDS_TAG,
    };
    const { service } = build(
      new Map([
        ['000061184/YD', foundResult('000061184/YD', agrees)],
        [
          '000061195/YD',
          foundResult('000061195/YD', { ...agrees, customer: 'C-100' }),
        ],
      ]),
    );
    const review = await service.review({
      fileBuffer: buffer,
      fileName: 'Yards.xlsx',
      companyId: 'm-p',
    });
    const summary = service.toSummary(review);
    expect(review.format).toBe('YARDS_SOURCE');
    expect(summary.sheets.map((s) => s.sourceSheet)).toEqual([
      '10-YARD-IST',
      'Atlantic',
      'yard.',
    ]);
    expect(summary.creditNoteInvoiceCount).toBe(1);
    expect(summary.canSubmit).toBe(false);

    const lines = service.toLines(review);
    const cn = lines.find((l) => l.invoiceNumber === '000000356/YD-CN');
    expect(cn).toMatchObject({
      creditNote: true,
      status: 'BLOCKED',
      sourceRefs: ['yard.!2'],
    });
    const discrepancy = lines.find((l) => l.invoiceNumber === '000061195/YD');
    expect(discrepancy).toMatchObject({
      status: 'BLOCKED',
      workbook: { customerAccounts: ['C-999'] },
      d365: { customerAccount: 'C-100' },
    });
    expect(discrepancy?.errors.join(' ')).toMatch(
      /workbook customer account \(C-999\) differs from D365 \(C-100\)/,
    );
    const valid = lines.find((l) => l.invoiceNumber === '000061184/YD');
    expect(valid?.errors).toEqual([]);
    expect(valid).toMatchObject({
      status: 'VALID',
      sourceRefs: ['10-YARD-IST!2'],
      paymentSerials: [],
    });
    expect(summary.discrepancyCount).toBe(1);
  });

  it('reports the offset-account status counts for the review', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [yardsRow({ FREETEXTNUMBER: '000061184/YD' })],
      },
    ]);
    const { service } = build(
      new Map([
        [
          '000061184/YD',
          foundResult('000061184/YD', {
            customer: '101000262',
            dimension: YARDS_DIMENSION,
            tag: YARDS_TAG,
          }),
        ],
      ]),
    );
    const review = await service.review({
      fileBuffer: buffer,
      fileName: 'Yards.xlsx',
      companyId: 'm-p',
    });
    expect(service.toSummary(review).offsetAccountCounts).toEqual([
      { status: 'OK', count: 1 },
    ]);
    expect(service.toSummary(review).canSubmit).toBe(true);
  });
});

describe('isYardInvoiceUploadEnabled', () => {
  it('is disabled by default and enabled only by an explicit true-like value', () => {
    expect(isYardInvoiceUploadEnabled({})).toBe(false);
    expect(
      isYardInvoiceUploadEnabled({ YARD_INVOICE_UPLOAD_ENABLED: 'false' }),
    ).toBe(false);
    expect(
      isYardInvoiceUploadEnabled({ YARD_INVOICE_UPLOAD_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      isYardInvoiceUploadEnabled({ YARD_INVOICE_UPLOAD_ENABLED: ' 1 ' }),
    ).toBe(true);
  });
});
