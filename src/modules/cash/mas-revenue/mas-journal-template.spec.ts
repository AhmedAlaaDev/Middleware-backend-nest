import ExcelJS from 'exceljs';

import {
  getMasJournalBlockers,
  type MasJournalLiveChecks,
} from './mas-journal-gates';
import { buildMasJournalGlLines } from './mas-journal-gl-body.builder';
import { cashEffectOf } from './mas-journal-line';
import { validateMasJournalGroups } from './mas-journal-posting-validator';
import {
  buildMasJournalTemplate,
  buildMasJournalUploadGuide,
} from './mas-journal-template';
import { MAS_JOURNAL_SHEET_NAME } from './mas-journal-template.constants';
import { normalizeMasJournalRows } from './mas-journal-template.normalizer';
import {
  isMasJournalWorkbook,
  parseMasJournalWorkbook,
} from './mas-journal-template.parser';
import { resolveJournalCurrencies } from './mas-revenue-currency';
import { completeMasRevenueConfig } from './mas-revenue.test-fixtures';

import type { MasRevenueCashAccountCheck } from './mas-revenue-cash-account-verifier';
import type { MasRevenuePostingGroupLike } from './mas-revenue-posting-validator';

type Row = Record<string, string | number>;

const RECEIPT: Row = {
  JOURNALNAME: 'GL Journal',
  TRANSDATE: '2026-10-28',
  ACCOUNTTYPE: 'RCash',
  ACCOUNTDISPLAYVALUE: 'Port Said',
  OFFSETACCOUNTTYPE: 'Ledger',
  OFFSETACCOUNTDISPLAYVALUE: '415701|2401|024|002|005',
  DEBITAMOUNT: 1824,
  ITEMSALESTAXGROUP: 'Tax 14',
  DOCUMENT: 'R-1',
  DEFAULTDIMENSIONDISPLAYVALUE: '|2401|024|002|005',
};
const PAYMENT: Row = {
  JOURNALNAME: 'GL Journal',
  TRANSDATE: '2026-10-28',
  ACCOUNTTYPE: 'Ledger',
  ACCOUNTDISPLAYVALUE: '524528|2401|024|002',
  OFFSETACCOUNTTYPE: 'RCash',
  OFFSETACCOUNTDISPLAYVALUE: 'Port Said',
  DEBITAMOUNT: 165,
  ITEMSALESTAXGROUP: 'NONTAXABLE',
  DOCUMENT: 'P-1',
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE: '|2401|024|002|005',
};

/** The downloadable template with the given rows entered on its journal sheet. */
async function workbookWith(rows: Row[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await buildMasJournalTemplate()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet(MAS_JOURNAL_SHEET_NAME)!;
  const headers = (sheet.getRow(1).values as string[]).map((value) =>
    String(value ?? ''),
  );
  rows.forEach((row, index) => {
    const target = sheet.getRow(index + 2);
    headers.forEach((header, column) => {
      if (column > 0 && row[header] !== undefined) {
        target.getCell(column).value = row[header];
      }
    });
    target.commit();
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function receiptsOf(rows: Row[]) {
  const parsed = await parseMasJournalWorkbook(await workbookWith(rows));
  return normalizeMasJournalRows(parsed);
}

const portSaid: MasRevenueCashAccountCheck = {
  id: 'Port Said',
  status: 'RCASH',
  currency: 'EGP',
  error: null,
};
const liveOk: MasJournalLiveChecks = {
  mainAccounts: [
    { key: '415701', exists: true, error: null },
    { key: '524528', exists: true, error: null },
  ],
  itemTaxGroups: [
    { key: 'Tax 14', exists: true, error: null },
    { key: 'NONTAXABLE', exists: true, error: null },
  ],
  reportingRates: [
    {
      date: '2026-10-28',
      reportingExchangeRate: 1.923,
      accountingCurrency: 'EGP',
      reportingCurrency: 'USD',
      error: null,
    },
  ],
};

describe('MAS journal-lines template (version 2)', () => {
  it('builds a template that is recognised, empty, and ignores the Examples sheet', async () => {
    const buffer = await buildMasJournalTemplate();
    expect(await isMasJournalWorkbook(buffer)).toBe(true);
    const result = normalizeMasJournalRows(
      await parseMasJournalWorkbook(buffer),
    );
    expect(result.receipts).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    expect(buildMasJournalUploadGuide()).toContain('Cash in or cash out');
  });

  it('reads a receipt and a payment, and identifies the direction from each row', async () => {
    const result = await receiptsOf([RECEIPT, PAYMENT]);
    expect(result.issues).toEqual([]);
    const [receipt, payment] = result.receipts;
    expect(cashEffectOf(receipt.journalLine!)).toBe('in');
    expect(cashEffectOf(payment.journalLine!)).toBe('out');
    expect(receipt.cashAccountDisplayName).toBe('Port Said');
    expect(payment.cashAccountDisplayName).toBe('Port Said');
    expect(receipt.totalMinor).toBe(182400);
    expect(payment.totalMinor).toBe(16500);
    expect(receipt.journalLine!.itemSalesTaxGroup).toBe('Tax 14');
  });

  it('flips the direction when the cash side and amount side change', async () => {
    const result = await receiptsOf([
      { ...RECEIPT, DEBITAMOUNT: '', CREDITAMOUNT: 50, DOCUMENT: 'R-2' },
      {
        ...PAYMENT,
        DEBITAMOUNT: '',
        CREDITAMOUNT: 70,
        DOCUMENT: 'P-2',
      },
    ]);
    const [cashCredit, ledgerCredit] = result.receipts;
    expect(cashEffectOf(cashCredit.journalLine!)).toBe('out');
    expect(cashEffectOf(ledgerCredit.journalLine!)).toBe('in');
  });

  it('rejects both sides cash, both amounts, and repeated documents', async () => {
    const result = await receiptsOf([
      { ...RECEIPT, OFFSETACCOUNTTYPE: 'RCash', DOCUMENT: 'A' },
      { ...RECEIPT, CREDITAMOUNT: 5, DOCUMENT: 'B' },
      { ...RECEIPT, DOCUMENT: 'C' },
      { ...PAYMENT, DOCUMENT: 'C' },
    ]);
    expect(result.receipts).toHaveLength(0);
    const messages = result.issues.map((issue) => issue.message).join(' | ');
    expect(messages).toContain('exactly one side must be RCash');
    expect(messages).toContain('not both');
    expect(messages).toContain('duplicate document number');
  });

  describe('gates', () => {
    async function resolved() {
      const { receipts } = await receiptsOf([RECEIPT, PAYMENT]);
      return resolveJournalCurrencies(receipts, [portSaid]);
    }

    it('takes the currency from the D365 cash account', async () => {
      expect((await resolved()).map((r) => r.currency)).toEqual(['EGP', 'EGP']);
    });

    it('has no blockers when D365 confirms the rows and the environment checks pass', async () => {
      const blockers = getMasJournalBlockers({
        config: completeMasRevenueConfig(),
        receipts: await resolved(),
        cashChecks: [portSaid],
        live: liveOk,
      });
      expect(blockers).toEqual([]);
    });

    it('blocks on the two environment checks, a missing account and a currency mismatch', async () => {
      const receipts = (await resolved()).map((receipt, index) =>
        index === 0 && receipt.journalLine
          ? {
              ...receipt,
              journalLine: { ...receipt.journalLine, requestedCurrency: 'USD' },
            }
          : receipt,
      );
      const blockers = getMasJournalBlockers({
        config: completeMasRevenueConfig({
          deployedCompatibility: {
            lineServiceVerifiedForGl: false,
            glReadbackVerified: false,
          },
        }),
        receipts,
        cashChecks: [portSaid],
        live: {
          ...liveOk,
          mainAccounts: [{ key: '415701', exists: false, error: null }],
        },
      });
      const text = blockers.join(' | ');
      expect(text).toContain('ledger main account "415701" does not exist');
      expect(text).toContain('ledger main account "524528" was not checked');
      expect(text).toContain('CURRENCYCODE USD differs');
      expect(text).toContain('line service has not been verified');
      expect(text).toContain('readback has not been verified');
    });

    it('blocks an unknown cash account', async () => {
      const blockers = getMasJournalBlockers({
        config: completeMasRevenueConfig(),
        receipts: await resolved(),
        cashChecks: [{ ...portSaid, status: 'UNKNOWN', currency: null }],
        live: liveOk,
      });
      expect(blockers.join(' ')).toContain(
        'does not exist in D365 CashAccounts',
      );
    });
  });

  describe('posting lines', () => {
    async function lines() {
      const { receipts } = await receiptsOf([RECEIPT, PAYMENT]);
      const resolved = resolveJournalCurrencies(receipts, [portSaid]);
      return buildMasJournalGlLines(resolved, liveOk);
    }

    it('builds the receipt with cash on the account side, as finance enters it', async () => {
      const [receipt] = await lines();
      expect(receipt.body).toMatchObject({
        AccountNum: 'Port Said',
        accountTypeStr: 'RCash',
        offsetAccountDisplayValue: '415701|2401|024|002|005',
        OffsetAccountTypeStr: 'Ledger',
        debitAmount: 1824,
        creditAmount: 0,
        currency: 'EGP',
        TAXITEMGROUP: 'Tax 14',
        ExchangeRate: 100,
        ReportingExchangeRate: 1.923,
      });
    });

    it('builds the payment with the ledger on the account side and cash as the offset', async () => {
      const [, payment] = await lines();
      expect(payment.body).toMatchObject({
        AccountNum: '524528|2401|024|002',
        accountTypeStr: 'Ledger',
        offsetAccountDisplayValue: 'Port Said',
        OffsetAccountTypeStr: 'RCash',
        debitAmount: 165,
        creditAmount: 0,
        TAXITEMGROUP: 'NONTAXABLE',
        offsetDEFAULTDIMENSIONDISPLAYVALUE: '|2401|024|002|005',
      });
    });

    it('refuses to build without a reporting rate or a currency', async () => {
      const { receipts } = await receiptsOf([RECEIPT]);
      const resolved = resolveJournalCurrencies(receipts, [portSaid]);
      expect(() =>
        buildMasJournalGlLines(resolved, { ...liveOk, reportingRates: [] }),
      ).toThrow('no reporting exchange rate');
      expect(() => buildMasJournalGlLines(receipts, liveOk)).toThrow(
        'currency is not resolved',
      );
    });

    function group(bodies: Array<Record<string, unknown>>) {
      return {
        header: {
          dataAreaId: 'mas',
          JournalName: 'GL Journal',
          Description: 'MAS journal b',
        },
        lines: bodies.map((body, index) => ({
          dataAreaId: 'mas',
          LineNumber: index + 1,
          cashDirection: 'in',
          customLineApiBody: body,
        })),
      } as unknown as MasRevenuePostingGroupLike;
    }

    it('passes the receipt and the payment through the structural validator', async () => {
      const built = await lines();
      expect(
        validateMasJournalGroups([
          group(built.map((line) => ({ ...line.body }))),
        ]),
      ).toEqual([]);
    });

    it('rejects a line with no cash side, both amounts, or no tax group', async () => {
      const [receipt] = await lines();
      const errors = validateMasJournalGroups([
        group([
          {
            ...receipt.body,
            OffsetAccountTypeStr: 'Ledger',
            accountTypeStr: 'Ledger',
          },
          { ...receipt.body, creditAmount: 5 },
          { ...receipt.body, TAXITEMGROUP: '' },
        ]),
      ]).join(' | ');
      expect(errors).toContain('one side must be RCash');
      expect(errors).toContain('either debit or credit');
      expect(errors).toContain('item sales-tax group is required');
    });
  });
});
