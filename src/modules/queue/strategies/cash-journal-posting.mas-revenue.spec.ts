/* eslint-disable @typescript-eslint/require-await -- test doubles mirror async contracts without I/O */
import { CashJournalPostingStrategy } from './cash-journal-posting.strategy';

import { buildMasRevenueGlLines } from '@/modules/cash/mas-revenue/mas-revenue-gl-body.builder';
import {
  completeMasRevenueConfig,
  masReceipt,
} from '@/modules/cash/mas-revenue/mas-revenue.test-fixtures';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { D365FOCustomerPaymentJournalLineRequest } from '@/modules/d365fo/types';

/** Planned lines for one receipt with VAT: the revenue line and the VAT line. */
function postingLines(): D365FOCustomerPaymentJournalLineRequest[] {
  const planned = buildMasRevenueGlLines(completeMasRevenueConfig(), [
    masReceipt({ invoiceNumber: '0012', revenueType: 'In' }),
  ]);
  return planned.map(
    (line, index) =>
      ({
        dataAreaId: 'mas',
        LineNumber: index + 1,
        sourceLineNumber: line.sourceRow,
        cashDirection: 'in',
        customLineApiBody: line.body,
      }) as unknown as D365FOCustomerPaymentJournalLineRequest,
  );
}

function buildStrategy(readRows: () => Promise<unknown[]>) {
  const customerPaymentJournalService = {
    postCashInLinesForHeader: jest.fn(
      async (headerKey: string, lines: Array<{ LineNumber: number }>) =>
        lines.map((line) => ({
          headerId: headerKey,
          lineNumber: line.LineNumber,
        })),
    ),
  };
  const ledgerStrategy = { listGlLineRows: jest.fn(readRows) };
  const strategy = new CashJournalPostingStrategy(
    customerPaymentJournalService as never,
    {} as never,
    {} as never,
    {} as never,
    ledgerStrategy as never,
  );
  return { strategy, customerPaymentJournalService, ledgerStrategy };
}

function masRoute() {
  return new CashJournalRoutingService().resolve({
    safeType: 'MAS Revenue',
    masRevenueJournalName: 'GL-VERIFIED',
  });
}

/** What D365 holds after a correct post: the revenue line and the VAT line. */
const actualRows = [
  {
    LineNumber: 1,
    AccountDisplayValue: 'PETTY-FIXTURE',
    CurrencyCode: 'EGP',
    DebitAmount: 1600,
    CreditAmount: 0,
    OffsetAccountDisplayValue: '415701|2401|024|002|005',
  },
  {
    LineNumber: 2,
    AccountDisplayValue: 'PETTY-FIXTURE',
    CurrencyCode: 'EGP',
    DebitAmount: 224,
    CreditAmount: 0,
    OffsetAccountDisplayValue: 'VAT-OUT-FIXTURE',
  },
];

describe('CashJournalPostingStrategy: MAS Revenue GL readback', () => {
  it('posts the lines through the cash-in line service on the GL header', async () => {
    const { strategy, customerPaymentJournalService } = buildStrategy(
      async () => actualRows,
    );
    strategy.setRouteContext(masRoute());

    await strategy.postLinesForHeader('000123', postingLines(), 'mas', 20);

    expect(
      customerPaymentJournalService.postCashInLinesForHeader,
    ).toHaveBeenCalledWith(
      '000123',
      expect.any(Array),
      20,
      'mas',
      expect.any(Function),
      true,
    );
  });

  it('accepts a journal whose content matches the plan', async () => {
    const { strategy, ledgerStrategy } = buildStrategy(async () => actualRows);
    strategy.setRouteContext(masRoute());

    await expect(
      strategy.postLinesForHeader('000123', postingLines(), 'mas', 20),
    ).resolves.toBeDefined();
    expect(ledgerStrategy.listGlLineRows).toHaveBeenCalledWith('000123', 'mas');
  });

  it('stops as non-retryable when the VAT line is missing from D365', async () => {
    const { strategy } = buildStrategy(async () => [actualRows[0]]);
    strategy.setRouteContext(masRoute());

    await expect(
      strategy.postLinesForHeader('000123', postingLines(), 'mas', 20),
    ).rejects.toThrow(/JOURNAL_READBACK_MISMATCH/);
  });

  it('stops as non-retryable when the posted content differs from the plan', async () => {
    const { strategy } = buildStrategy(async () => [
      { ...actualRows[0], DebitAmount: 1800 },
      actualRows[1],
    ]);
    strategy.setRouteContext(masRoute());

    await expect(
      strategy.postLinesForHeader('000123', postingLines(), 'mas', 20),
    ).rejects.toThrow(/JOURNAL_READBACK_MISMATCH/);
  });

  it('stops as non-retryable when the journal cannot be read back', async () => {
    const { strategy } = buildStrategy(async () => {
      throw new Error('service unavailable');
    });
    strategy.setRouteContext(masRoute());

    await expect(
      strategy.postLinesForHeader('000123', postingLines(), 'mas', 20),
    ).rejects.toThrow(/JOURNAL_READBACK_FAILED/);
  });

  it('does not run the MAS readback for the existing Direct route', async () => {
    const { strategy, ledgerStrategy } = buildStrategy(async () => []);
    strategy.setRouteContext(
      new CashJournalRoutingService().resolve({ safeType: 'Direct' }),
    );

    await strategy
      .postLinesForHeader('000123', postingLines(), 'mas', 20)
      .catch(() => undefined);

    expect(ledgerStrategy.listGlLineRows).not.toHaveBeenCalled();
  });

  it('refuses a MAS route without a journal name', () => {
    const { strategy } = buildStrategy(async () => []);
    const route = { ...masRoute(), journalName: '' };
    expect(() => strategy.setRouteContext(route)).toThrow(
      /Invalid cash journal route/,
    );
  });
});
