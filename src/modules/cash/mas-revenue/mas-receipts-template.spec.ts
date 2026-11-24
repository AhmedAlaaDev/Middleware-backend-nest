import ExcelJS from 'exceljs';

import { buildMasJournalGlLines } from './mas-journal-gl-body.builder';
import { validateMasJournalGroups } from './mas-journal-posting-validator';
import {
  buildMasReceiptsGuide,
  buildMasReceiptsTemplate,
} from './mas-receipts-template';
import {
  MAS_RECEIPTS_SHEET_NAME,
  MAS_REVENUE_TYPES_SHEET_NAME,
} from './mas-receipts-template.constants';
import {
  isMasReceiptsWorkbook,
  normalizeMasReceipts,
  parseMasReceiptsWorkbook,
} from './mas-receipts-template.reader';
import { resolveJournalCurrencies } from './mas-revenue-currency';

import type { MasJournalLiveChecks } from './mas-journal-gates';
import type { MasRevenuePostingGroupLike } from './mas-revenue-posting-validator';

type Row = Record<string, string | number>;

/** The three receipts of MAS_Direct_Revenue_English(1).xlsx, as the users keep them. */
const GIVAUDAN: Row[] = [
  ['2026-10-28', '1', 'SEKU1165565'],
  ['2026-10-28', '2', 'HAMU1030642'],
  ['2026-10-29', '3', 'HLBU3775017'],
].map(([date, invoice, container]) => ({
  Date: date,
  'Invoice No': invoice,
  Customer: 'GIVAUDAN EGYPT',
  'Revenue Type': 'In ',
  'Cash Account': 'Port Said',
  'Value (excl. VAT)': 1600,
  VAT: 224,
  Total: 1824,
  'Container Type': '20DC',
  'Container No': container,
  'B/L': 'HLCUIZ1260983630',
  'Sea Line': 'Habag Lloyd',
  'VAT Card No': '100497772',
}));

function headerColumns(sheet: ExcelJS.Worksheet): Map<string, number> {
  const columns = new Map<string, number>();
  sheet.getRow(4).eachCell((cell, column) => {
    const text = typeof cell.value === 'string' ? cell.value : '';
    columns.set(text.replace(' *', ''), column);
  });
  return columns;
}

async function workbookWith(
  receipts: Row[],
  revenueTypes?: Row[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await buildMasReceiptsTemplate()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  const sheet = workbook.getWorksheet(MAS_RECEIPTS_SHEET_NAME)!;
  const columns = headerColumns(sheet);
  receipts.forEach((row, index) => {
    for (const [header, value] of Object.entries(row)) {
      const column = columns.get(header);
      if (column) sheet.getCell(5 + index, column).value = value;
    }
  });
  if (revenueTypes) {
    const types = workbook.getWorksheet(MAS_REVENUE_TYPES_SHEET_NAME)!;
    const typeColumns = headerColumns(types);
    for (let r = 5; r < 10; r += 1) {
      for (const column of typeColumns.values()) {
        types.getCell(r, column).value = null;
      }
    }
    revenueTypes.forEach((row, index) => {
      for (const [header, value] of Object.entries(row)) {
        const column = typeColumns.get(header);
        if (column) types.getCell(5 + index, column).value = value;
      }
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function read(receipts: Row[], revenueTypes?: Row[]) {
  return normalizeMasReceipts(
    await parseMasReceiptsWorkbook(await workbookWith(receipts, revenueTypes)),
  );
}

const portSaid = {
  id: 'Port Said',
  status: 'RCASH' as const,
  currency: 'EGP',
  error: null,
};
const live: MasJournalLiveChecks = {
  mainAccounts: [{ key: '415701', exists: true, error: null }],
  itemTaxGroups: [{ key: 'Tax 14', exists: true, error: null }],
  reportingRates: [
    {
      date: '2026-10-28',
      reportingExchangeRate: 100 / 52,
      accountingCurrency: 'EGP',
      reportingCurrency: 'USD',
      error: null,
    },
    {
      date: '2026-10-29',
      reportingExchangeRate: 100 / 52,
      accountingCurrency: 'EGP',
      reportingCurrency: 'USD',
      error: null,
    },
  ],
};

describe('MAS cash receipts template (version 3)', () => {
  it('is recognised, starts empty, and carries the one evidenced revenue type', async () => {
    const buffer = await buildMasReceiptsTemplate();
    expect(await isMasReceiptsWorkbook(buffer)).toBe(true);
    const result = normalizeMasReceipts(await parseMasReceiptsWorkbook(buffer));
    expect(result.receipts).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        revenueType: 'In',
        revenueAccount: '415701|2401|024|002|005',
        itemSalesTaxGroup: 'Tax 14',
        postingProfile: 'Cash',
        journalName: 'GL Journal',
      }),
    ]);
  });

  it('reads the users’ receipts into the line finance enters on journal 271', async () => {
    const result = await read(GIVAUDAN);
    expect(result.issues).toEqual([]);
    expect(result.receipts).toHaveLength(3);
    const [first] = result.receipts;
    expect(first).toMatchObject({
      invoiceNumber: '1',
      transactionDate: '2026-10-28',
      valueMinor: 160000,
      vatMinor: 22400,
      totalMinor: 182400,
      cashAccountDisplayName: 'Port Said',
      customerName: 'GIVAUDAN EGYPT',
      revenueType: 'In',
      containerNumber: 'SEKU1165565',
      billOfLading: 'HLCUIZ1260983630',
      seaLine: 'Habag Lloyd',
      vatCardNumber: '100497772',
    });
    expect(first.journalLine).toEqual({
      journalName: 'GL Journal',
      accountType: 'RCash',
      account: 'Port Said',
      offsetAccountType: 'Ledger',
      offsetAccount: '415701|2401|024|002|005',
      side: 'debit',
      itemSalesTaxGroup: 'Tax 14',
      salesTaxGroup: '',
      postingProfile: 'Cash',
      defaultDimension: '',
      offsetDefaultDimension: '',
      finTag: '',
      offsetFinTag: '',
      text: 'GIVAUDAN EGYPT - 1',
      requestedCurrency: '',
    });
  });

  it('builds and validates GL lines equal to journal 271 on every accounting field', async () => {
    const { receipts } = await read(GIVAUDAN);
    const lines = buildMasJournalGlLines(
      resolveJournalCurrencies(receipts, [portSaid]),
      live,
    );
    expect(lines[0].body).toMatchObject({
      AccountNum: 'Port Said',
      accountTypeStr: 'RCash',
      offsetAccountDisplayValue: '415701|2401|024|002|005',
      OffsetAccountTypeStr: 'Ledger',
      debitAmount: 1824,
      creditAmount: 0,
      currency: 'EGP',
      ExchangeRate: 100,
      TAXITEMGROUP: 'Tax 14',
      TaxGroup: '',
      PostingProfile: 'Cash',
      DEFAULTDIMENSIONDISPLAYVALUE: '',
      TRANSACTIONTEXT: 'GIVAUDAN EGYPT - 1',
    });
    const errors = validateMasJournalGroups([
      {
        header: {
          dataAreaId: 'mas',
          JournalName: 'GL Journal',
          Description: 'MAS journal b',
        },
        lines: lines.map((line, index) => ({
          dataAreaId: 'mas',
          LineNumber: index + 1,
          cashDirection: 'in',
          customLineApiBody: { ...line.body },
        })),
      } as unknown as MasRevenuePostingGroupLike,
    ]);
    expect(errors).toEqual([]);
  });

  it('names each wrong row: total, VAT, unknown type, missing cash account, repeated invoice', async () => {
    const [base] = GIVAUDAN;
    const result = await read([
      { ...base, 'Invoice No': 'A', Total: 1800 },
      { ...base, 'Invoice No': 'B', VAT: -1, Total: 1599 },
      { ...base, 'Invoice No': 'C', 'Revenue Type': 'Storage' },
      { ...base, 'Invoice No': 'D', 'Cash Account': '' },
      { ...base, 'Invoice No': 'E' },
      { ...base, 'Invoice No': 'E' },
    ]);
    expect(result.receipts).toHaveLength(0);
    const text = result.issues
      .map((issue) => `${issue.sourceRow}:${issue.column}:${issue.message}`)
      .join(' | ');
    expect(text).toContain(
      '5:Total:Value + VAT is 1824.00, but Total is 1800.00',
    );
    expect(text).toContain('6:VAT:VAT must not be negative');
    expect(text).toContain(
      '7:Revenue Type:revenue type "Storage" is not on the Revenue Types sheet',
    );
    expect(text).toContain('8:Cash Account:cash account is required');
    expect(text).toContain('9:Invoice No:invoice E appears more than once');
    expect(text).toContain('10:Invoice No:invoice E appears more than once');
  });

  it('refuses receipts whose revenue type is incomplete on the Revenue Types sheet', async () => {
    const result = await read(GIVAUDAN.slice(0, 1), [
      {
        'Revenue Type': 'In',
        'Revenue Account': '',
        'Item Sales Tax Group': 'Tax 14',
        'Journal Name': 'GL Journal',
      },
    ]);
    expect(result.receipts).toHaveLength(0);
    const messages = result.issues.map((issue) => issue.message);
    expect(messages).toContain('revenue account is required');
    expect(messages).toContain(
      'revenue type "In" has a problem on the Revenue Types sheet; fix it there',
    );
  });

  it('takes the sales tax group finance sets for a type', async () => {
    const result = await read(GIVAUDAN.slice(0, 1), [
      {
        'Revenue Type': 'In',
        'Revenue Account': '415701|2401|024|002|005',
        'Item Sales Tax Group': 'Tax 14',
        'Sales Tax Group': 'TAX',
        'Journal Name': 'GL Journal',
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.receipts[0].journalLine?.salesTaxGroup).toBe('TAX');
    expect(result.receipts[0].journalLine?.postingProfile).toBe('');
  });

  it('has a guide that explains the sheets and the checks', () => {
    const guide = buildMasReceiptsGuide();
    expect(guide).toContain('## Receipts columns');
    expect(guide).toContain('Total must equal Value + VAT');
  });
});

describe('MAS cash receipts template: row counts', () => {
  it('counts only the rows entered, not the formatted empty rows of the template', async () => {
    const parsed = await parseMasReceiptsWorkbook(await workbookWith(GIVAUDAN));
    expect(parsed.scannedRowCount - parsed.headerRow).toBe(3);
    expect(parsed.blankRows).toBe(0);
    expect(parsed.receipts).toHaveLength(3);
  });
});
