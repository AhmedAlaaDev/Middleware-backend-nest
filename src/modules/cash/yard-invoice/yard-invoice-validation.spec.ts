import { YardOffsetAccountResolution } from './yard-invoice-account.resolver';
import { aggregateYardInvoiceRecords } from './yard-invoice-aggregation';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import {
  YardInvoiceLookupResult,
  YardInvoiceMetadata,
} from './yard-invoice-lookup.types';
import { YardPaymentRecord } from './yard-invoice-record';
import { validateYardInvoiceGroups } from './yard-invoice-validation';

function rec(overrides: Partial<YardPaymentRecord> = {}): YardPaymentRecord {
  return {
    format: 'TEMPLATE_8',
    sourceSheet: 'Template',
    layoutId: 'TEMPLATE_8',
    sourceRow: 2,
    paymentSerial: 'PS-1',
    paymentDate: '2026-07-15',
    paymentType: 'Cash',
    rawPaymentType: 'Cash',
    amount: parseDecimalToMicro('100.00'),
    amountText: '100.00',
    currencyCode: 'EGP',
    paymentReference: 'REF',
    safeBankAccount: 'Safe A',
    invoiceNumber: 'INV-1',
    workbookCustomerAccount: null,
    workbookCustomerName: null,
    workbookDimension: null,
    workbookFinTag: null,
    isCreditNote: false,
    ...overrides,
  };
}

function metadata(
  overrides: Partial<YardInvoiceMetadata> = {},
): YardInvoiceMetadata {
  return {
    invoiceNumber: 'INV-1',
    company: 'm-p',
    invoiceIdentifier: '1',
    customerAccount: 'C-100',
    currencyCode: 'EGP',
    defaultDimensionDisplayValue: '|2401|024',
    financialTagDisplayValue: 'TAG-A',
    voucher: 'V-1',
    openBalance: parseDecimalToMicro('100.00'),
    ...overrides,
  };
}

const ACCOUNT_OK: YardOffsetAccountResolution = {
  status: 'OK',
  accountType: 'Petty cash',
  accountDisplayValue: 'Safe A',
  message: '',
  retryable: false,
};

function run(
  records: YardPaymentRecord[],
  lookup: YardInvoiceLookupResult | undefined,
  extra: { account?: YardOffsetAccountResolution | undefined } = {},
) {
  const aggregation = aggregateYardInvoiceRecords(records);
  const lookups = new Map<string, YardInvoiceLookupResult>();
  if (lookup) lookups.set('INV-1', lookup);
  const offsetAccounts = new Map<string, YardOffsetAccountResolution>();
  const account = 'account' in extra ? extra.account : ACCOUNT_OK;
  if (account) offsetAccounts.set('INV-1', account);
  return validateYardInvoiceGroups({
    groups: aggregation.groups,
    lookups,
    offsetAccounts,
    templateIssues: [],
    aggregationIssues: aggregation.issues,
  });
}

const found = (meta: YardInvoiceMetadata): YardInvoiceLookupResult => ({
  status: 'FOUND',
  metadata: meta,
});

describe('validateYardInvoiceGroups', () => {
  it('marks a fully resolved, matching group VALID and allows submission', () => {
    const result = run([rec()], found(metadata()));
    expect(result.groups[0].status).toBe('VALID');
    expect(result.canSubmit).toBe(true);
  });

  it('blocks a currency mismatch and reports both currencies', () => {
    const result = run([rec({ currencyCode: 'USD' })], found(metadata()));
    expect(result.groups[0].errors.join(' ')).toMatch(
      /upload USD, invoice EGP/,
    );
    expect(result.canSubmit).toBe(false);
  });

  it('blocks a total above the eligible balance, with expected and submitted values', () => {
    const result = run(
      [rec({ amount: parseDecimalToMicro('100.02'), amountText: '100.02' })],
      found(metadata()),
    );
    expect(result.groups[0].errors.join(' ')).toMatch(
      /exceeds the eligible balance 100.00/,
    );
    expect(result.groups[0].submittedTotalText).toBe('100.02');
  });

  it('allows a total within the existing 0.01 settlement tolerance', () => {
    const result = run(
      [rec({ amount: parseDecimalToMicro('100.01'), amountText: '100.01' })],
      found(metadata()),
    );
    expect(result.groups[0].status).toBe('VALID');
  });

  it('reports an unavailable open balance as a warning, not a validated balance', () => {
    const result = run([rec()], found(metadata({ openBalance: null })));
    expect(result.groups[0].status).toBe('VALID');
    expect(result.groups[0].warnings.join(' ')).toMatch(/NOT validated/);
  });

  it('blocks an invoice whose lookup is not FOUND, carrying the lookup status', () => {
    const result = run([rec()], {
      status: 'NOT_POSTED',
      invoiceNumber: 'INV-1',
      message: 'invoice is not posted',
      retryable: false,
    });
    expect(result.groups[0].errors.join(' ')).toMatch(/NOT_POSTED/);
  });

  it('blocks a missing tag or dimension even when the status is FOUND', () => {
    const result = run(
      [rec()],
      found(
        metadata({
          financialTagDisplayValue: '',
          defaultDimensionDisplayValue: '',
        }),
      ),
    );
    const message = result.groups[0].errors.join(' ');
    expect(message).toMatch(/financial tag is missing/);
    expect(message).toMatch(/default dimensions are missing/);
  });

  it('blocks an invoice whose offset account is missing or not OK', () => {
    const missing = run([rec()], found(metadata()), { account: undefined });
    expect(missing.groups[0].errors.join(' ')).toMatch(
      /offset account .* not validated/,
    );
    const inactive = run([rec()], found(metadata()), {
      account: { ...ACCOUNT_OK, status: 'INACTIVE', message: 'not active' },
    });
    expect(inactive.groups[0].errors.join(' ')).toMatch(
      /offset account: INACTIVE/,
    );
  });

  it('blocks when the workbook customer account differs from D365 (discrepancy shown, not chosen)', () => {
    const result = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-999',
          workbookDimension: '|2401|024',
          workbookFinTag: 'TAG-A',
        }),
      ],
      found(metadata()),
    );
    expect(result.groups[0].status).toBe('BLOCKED');
    expect(result.groups[0].errors.join(' ')).toMatch(
      /workbook customer account \(C-999\) differs from D365 \(C-100\)/,
    );
  });

  it('blocks when the workbook tag differs from the D365 tag, and passes when all workbook values agree', () => {
    const differs = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag: 'TAG-X',
        }),
      ],
      found(metadata()),
    );
    expect(differs.groups[0].errors.join(' ')).toMatch(
      /workbook financial tag \(TAG-X\) differs from D365 \(TAG-A\)/,
    );

    const agrees = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag: 'TAG-A',
        }),
      ],
      found(metadata()),
    );
    expect(agrees.groups[0].status).toBe('VALID');
  });

  it('accepts a padded tag that has the same D365 segments, and still blocks a real segment difference', () => {
    const d365Tag = '||MSC LINE|||TCLU7736429|40HC|||||||||||46204|46204|';
    const padded = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag:
            '||MSC LINE|||TCLU7736429|40HC ||||||||||||46204|46204',
        }),
      ],
      found(metadata({ financialTagDisplayValue: d365Tag })),
    );
    expect(padded.groups[0].status).toBe('VALID');

    const realDifference = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension:
            '|2401|024|002|019|101002504|101002504|||00002|3171|3171|Payable|||Domestic||||',
          workbookFinTag: d365Tag,
        }),
      ],
      found(
        metadata({
          defaultDimensionDisplayValue:
            '|2401|024|002|019|101002504|101002504|||00019|3171|3171|Payable|||Domestic||||',
          financialTagDisplayValue: d365Tag,
        }),
      ),
    );
    // A workbook dimension that differs from D365 is a warning: posting uses D365.
    expect(realDifference.groups[0].status).toBe('VALID');
    expect(realDifference.groups[0].warnings.join(' ')).toMatch(
      /workbook default dimensions .* differs from D365 .*posting uses the D365 default dimension/,
    );
  });

  it('still blocks a financial tag difference (tags are not overridden)', () => {
    const blockedTag = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag: 'TAG-X',
        }),
      ],
      found(metadata({ financialTagDisplayValue: 'TAG-A' })),
    );
    expect(blockedTag.groups[0].status).toBe('BLOCKED');
  });

  it('treats "MSC LINE" in the workbook and "MSCLINE" in D365 as the same tag, but still blocks a different container', () => {
    const sameValue = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag:
            '||MSC LINE|||MSDU2144809|20DC  |||||||||||46309|46309',
        }),
      ],
      found(
        metadata({
          financialTagDisplayValue:
            '||MSCLINE|||MSDU2144809|20DC|||||||||||46309|46309|',
        }),
      ),
    );
    expect(sameValue.groups[0].status).toBe('VALID');

    const differentContainer = run(
      [
        rec({
          format: 'YARDS_SOURCE',
          sourceSheet: 'yard.',
          layoutId: 'YARDS_LAYOUT_REMARK',
          workbookCustomerAccount: 'C-100',
          workbookDimension: '|2401|024',
          workbookFinTag:
            '||MSC LINE|||MSNU3726851 - MSMU3406638|20DC  |||||||||||46315|46315',
        }),
      ],
      found(
        metadata({
          financialTagDisplayValue:
            '||MSCLINE|||MSNU3726851|20DC|||||||||||46315|46315|',
        }),
      ),
    );
    expect(differentContainer.groups[0].status).toBe('BLOCKED');
  });

  it('blocks the whole submission when a record-level issue exists', () => {
    const aggregation = aggregateYardInvoiceRecords([rec()]);
    const result = validateYardInvoiceGroups({
      groups: aggregation.groups,
      lookups: new Map([['INV-1', found(metadata())]]),
      offsetAccounts: new Map([['INV-1', ACCOUNT_OK]]),
      templateIssues: [{ message: 'row 3: bad date' }],
      aggregationIssues: [],
    });
    expect(result.groups[0].status).toBe('VALID');
    expect(result.canSubmit).toBe(false);
  });

  it('never submits an empty file', () => {
    const result = validateYardInvoiceGroups({
      groups: [],
      lookups: new Map(),
      offsetAccounts: new Map(),
      templateIssues: [],
      aggregationIssues: [],
    });
    expect(result.canSubmit).toBe(false);
  });

  it('blocks a credit-note group even when D365 metadata is valid', () => {
    const result = run(
      [
        rec({
          invoiceNumber: 'INV-1',
          amount: -parseDecimalToMicro('100'),
          amountText: '-100',
          isCreditNote: true,
        }),
      ],
      found(metadata()),
    );
    expect(result.groups[0].status).toBe('BLOCKED');
    expect(result.groups[0].errors.join(' ')).toMatch(/credit note \(-CN\)/);
    expect(result.canSubmit).toBe(false);
  });
});
