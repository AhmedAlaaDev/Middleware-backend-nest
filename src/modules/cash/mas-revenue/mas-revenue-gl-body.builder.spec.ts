import { getMasRevenueSubmissionBlockers } from './mas-revenue-config';
import {
  buildMasRevenueGlHeaderBody,
  buildMasRevenueGlLines,
  buildTransactionText,
} from './mas-revenue-gl-body.builder';
import {
  completeMasRevenueConfig,
  FIXTURE_CASH_NAME,
  masReceipt,
} from './mas-revenue.test-fixtures';
import { MasRevenueError } from './mas-revenue.types';

import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';

/** The real serializer projection (internal -> exact wire keys), called without DI. */
function toWire(body: unknown) {
  const service = Object.create(
    CustomerPaymentJournalService.prototype,
  ) as unknown as {
    toD365BulkCashLine: (
      l: unknown,
      d: 'in' | 'out',
    ) => Record<string, unknown>;
  };
  return service.toD365BulkCashLine(body, 'in');
}

describe('buildMasRevenueGlLines: direct cash revenue', () => {
  it('debits cash for the full total across a revenue line and a VAT line', () => {
    const lines = buildMasRevenueGlLines(completeMasRevenueConfig(), [
      masReceipt(),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.body.debitAmount)).toEqual([1600, 224]);
    expect(lines.reduce((sum, l) => sum + l.body.debitAmount, 0)).toBe(1824);
    for (const line of lines) {
      expect(line.body.accountTypeStr).toBe('RCash');
      expect(line.body.AccountNum).toBe('PETTY-FIXTURE');
      expect(line.body.creditAmount).toBe(0);
      expect(line.body.company).toBe('mas');
      expect(line.body.OffsetCompany).toBe('mas');
      expect(line.body.OffsetAccountTypeStr).toBe('Ledger');
      expect(line.body.MarkedLines).toEqual([]);
      expect(line.body.journalNum).toBe('');
      expect(line.sourceRow).toBe(2);
    }
  });

  it('credits the revenue account selected by the row Revenue type, not a fixed account', () => {
    const [loading, loadingVat] = buildMasRevenueGlLines(
      completeMasRevenueConfig(),
      [masReceipt({ revenueType: 'Loading' })],
    );
    const [inRevenue] = buildMasRevenueGlLines(completeMasRevenueConfig(), [
      masReceipt({ revenueType: 'In' }),
    ]);

    expect(loading.body.offsetAccountDisplayValue).toBe('415101');
    expect(loading.body.offsetDEFAULTDIMENSIONDISPLAYVALUE).toBe('DIM-LOADING');
    expect(inRevenue.body.offsetAccountDisplayValue).toBe(
      '415701|2401|024|002|005',
    );
    expect(loadingVat.body.offsetAccountDisplayValue).toBe('VAT-OUT-FIXTURE');
  });

  it('credits VAT exactly once, through the VAT line', () => {
    const lines = buildMasRevenueGlLines(completeMasRevenueConfig(), [
      masReceipt(),
    ]);
    const vatLines = lines.filter(
      (l) => l.body.offsetAccountDisplayValue === 'VAT-OUT-FIXTURE',
    );
    const revenueLines = lines.filter(
      (l) => l.body.offsetAccountDisplayValue === '415101',
    );

    expect(vatLines).toHaveLength(1);
    expect(vatLines[0].body.debitAmount).toBe(224);
    expect(revenueLines).toHaveLength(1);
    expect(revenueLines[0].body.debitAmount).toBe(1600);
  });

  it('emits no VAT line for a row without VAT', () => {
    const config = completeMasRevenueConfig({ vatRatePercent: 0 });
    const lines = buildMasRevenueGlLines(config, [
      masReceipt({ valueMinor: 100000, vatMinor: 0, totalMinor: 100000 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].body.debitAmount).toBe(1000);
  });

  it('uses the payment identities per part so each line is unique', () => {
    const lines = buildMasRevenueGlLines(completeMasRevenueConfig(), [
      masReceipt(),
    ]);
    expect(lines.map((l) => l.body.PAYMENTID)).toEqual([
      'MASREV-1-REV',
      'MASREV-1-VAT',
    ]);
  });

  it('keeps Arabic text and leading-zero account IDs as they are', () => {
    const config = completeMasRevenueConfig({
      vatRatePercent: 0,
      revenueAccountsByRevenueType: {
        Loading: {
          account: '415101',
          defaultDimension: 'DIM',
          financialTag: '',
          verified: true,
        },
      },
    });
    const [line] = buildMasRevenueGlLines(config, [
      masReceipt({
        customerName: 'شركة اختبار',
        invoiceNumber: '0012',
        vatMinor: 0,
        totalMinor: 160000,
      }),
    ]);
    expect(line.body.TRANSACTIONTEXT).toBe('شركة اختبار - 0012');
    expect(line.body.DocumentNum).toBe('0012');
  });

  it('projects to the exact wire keys with MarkedLines [] and no internal aliases', () => {
    const [line] = buildMasRevenueGlLines(completeMasRevenueConfig(), [
      masReceipt(),
    ]);
    const wire = toWire(line.body);

    expect(wire).toEqual(
      expect.objectContaining({
        AccountTypeStr: 'RCash',
        OffsetAccountTypeStr: 'Ledger',
        OffsetAccountDisplayValue: '415101',
        Company: 'mas',
        OffsetCompany: 'mas',
        DebitAmount: 1600,
        MarkedLines: [],
        TaxGroup: '',
        TAXITEMGROUP: 'FIXTURE-ITEM-TAX',
      }),
    );
    for (const alias of [
      'journalNum',
      'accountTypeStr',
      'debitAmount',
      'company',
      'transDate',
      'offsetAccountDisplayValue',
    ]) {
      expect(wire).not.toHaveProperty(alias);
    }
  });

  it('refuses to build while any gate is closed', () => {
    expect(() =>
      buildMasRevenueGlLines(completeMasRevenueConfig({ journalName: null }), [
        masReceipt(),
      ]),
    ).toThrow(/submission is blocked/);
  });

  it('refuses to build with no receipts', () => {
    expect(() =>
      buildMasRevenueGlLines(completeMasRevenueConfig(), []),
    ).toThrow(/there are no accepted receipts/);
  });
});

describe('configuration gates', () => {
  it('blocks a Revenue type that has no configured revenue account', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt({ revenueType: 'Storage' })],
    );
    expect(blockers.join('\n')).toMatch(
      /Revenue type "Storage" has no revenue account in configuration/,
    );
  });

  it('blocks an unverified revenue account and a revenue account without a dimension', () => {
    const config = completeMasRevenueConfig({
      revenueAccountsByRevenueType: {
        Loading: {
          account: '415101',
          defaultDimension: '',
          financialTag: '',
          verified: false,
        },
      },
    });
    const text = getMasRevenueSubmissionBlockers(config, [masReceipt()]).join(
      '\n',
    );
    expect(text).toMatch(
      /Revenue type "Loading" account 415101 has not been verified/,
    );
    expect(text).toMatch(
      /Revenue type "Loading" account 415101 has no verified default dimension/,
    );
  });

  it('blocks a row with an empty Revenue type', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt({ revenueType: null })],
    );
    expect(blockers.join('\n')).toMatch(/Revenue type is empty/);
  });

  it('blocks when the VAT rate or VAT account is not configured', () => {
    const noRate = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({ vatRatePercent: null }),
      [masReceipt()],
    );
    expect(noRate.join('\n')).toMatch(/VAT rate is not configured/);

    const noAccount = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({ vatAccount: null }),
      [masReceipt()],
    );
    expect(noAccount.join('\n')).toMatch(/VAT account is not configured/);

    const unverified = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        vatAccount: {
          account: 'VAT-OUT-FIXTURE',
          defaultDimension: 'DIM-VAT',
          financialTag: '',
          verified: false,
        },
      }),
      [masReceipt()],
    );
    expect(unverified.join('\n')).toMatch(
      /VAT account VAT-OUT-FIXTURE has not been verified/,
    );
  });

  it('blocks a row whose VAT does not equal the configured rate of its value', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt({ vatMinor: 22000 })],
    );
    expect(blockers.join('\n')).toMatch(
      /invoice 1: VAT 220\.00 does not equal 14% of value 1600\.00 \(224\.00\)/,
    );
  });

  it('reports a debit value that is not a configured cash account as unknown or unsupported, without calling it a credit sale', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt({ cashAccountDisplayName: 'Ahmed Customer Ltd' })],
    );
    const text = blockers.join('\n');
    expect(text).toMatch(
      /unknown or unsupported cash account "Ahmed Customer Ltd"/,
    );
    expect(text).not.toMatch(/credit/i);
    expect(text).toMatch(/unknown or unsupported cash account/);
  });

  it('blocks a cash account that is configured but has no ID', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        cashAccountIdsByDisplayName: { [FIXTURE_CASH_NAME]: '' },
      }),
      [masReceipt()],
    );
    expect(blockers.join('\n')).toMatch(/has no verified MAS account ID/);
  });

  it('does not infer cash from a customer name: a configured cash account is accepted whatever the customer is', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt({ customerName: 'Some Customer Ltd' })],
    );
    expect(blockers).toEqual([]);
  });

  it('allows an explicitly empty financial tag', () => {
    expect(
      getMasRevenueSubmissionBlockers(
        completeMasRevenueConfig({ cashFinancialTag: '' }),
        [masReceipt()],
      ),
    ).toEqual([]);
  });

  it('keeps submission closed until the line service and GL readback are verified', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        deployedCompatibility: {
          lineServiceVerifiedForGl: false,
          glReadbackVerified: false,
        },
      }),
      [masReceipt()],
    );
    expect(blockers.join('\n')).toMatch(
      /cash-in line service has not been verified/,
    );
    expect(blockers.join('\n')).toMatch(
      /GL journal readback has not been verified/,
    );
  });
});

describe('buildMasRevenueGlHeaderBody', () => {
  it('uses dataAreaId mas and the configured JournalName', () => {
    expect(
      buildMasRevenueGlHeaderBody(
        completeMasRevenueConfig(),
        [masReceipt()],
        'UPLOAD-1',
      ),
    ).toEqual({
      dataAreaId: 'mas',
      JournalName: 'GL-VERIFIED',
      Description: 'MAS Revenue Cash In UPLOAD-1',
    });
  });

  it('refuses to build a header while blockers remain', () => {
    expect(() =>
      buildMasRevenueGlHeaderBody(
        completeMasRevenueConfig({ journalName: null }),
        [masReceipt()],
        'UPLOAD-1',
      ),
    ).toThrow(MasRevenueError);
  });
});

describe('buildTransactionText', () => {
  it('refuses text longer than the limit rather than truncating it silently', () => {
    expect(() =>
      buildTransactionText(masReceipt({ customerName: 'x'.repeat(120) })),
    ).toThrow(MasRevenueError);
  });
});

describe('MAS dimension rule: a composite that carries its dimensions needs no default-dimension string', () => {
  const composite = (account: string, defaultDimension: string) =>
    completeMasRevenueConfig({
      revenueAccountsByRevenueType: {
        Loading: {
          account,
          defaultDimension,
          financialTag: '',
          verified: true,
        },
      },
    });

  it('does not block a verified revenue account whose composite carries its dimensions', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      composite('415701|2401|024|002|005', ''),
      [masReceipt({ revenueType: 'Loading', vatMinor: 22400 })],
    );
    expect(blockers.join('\n')).not.toMatch(/no verified default dimension/);
  });

  it('still blocks a bare main account with no default dimension, because its dimensions are missing', () => {
    const blockers = getMasRevenueSubmissionBlockers(composite('415101', ''), [
      masReceipt({ revenueType: 'Loading' }),
    ]);
    expect(blockers.join('\n')).toMatch(
      /account 415101 has no verified default dimension/,
    );
  });

  it('does not invent a dimension: the offset default stays empty and the composite carries the segments', () => {
    const lines = buildMasRevenueGlLines(
      { ...composite('415701|2401|024|002|005', ''), vatRatePercent: 0 },
      [
        masReceipt({
          revenueType: 'Loading',
          vatMinor: 0,
          valueMinor: 182400,
          totalMinor: 182400,
        }),
      ],
    );
    expect(lines[0].body.offsetDEFAULTDIMENSIONDISPLAYVALUE).toBe('');
    expect(lines[0].body.offsetAccountDisplayValue).toBe(
      '415701|2401|024|002|005',
    );
  });
});
