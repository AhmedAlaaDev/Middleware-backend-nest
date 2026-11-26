import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

import { CREDIT_NOTE_SETTLEMENT_SAFE_TYPE } from '@/modules/cash/credit-note-settlement/credit-note-settlement.constants';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { resolveCompanyRunConfig } from '@/modules/master-data/company-run-config';

const RUN = resolveCompanyRunConfig('m-p', [], {
  rateType: 'default',
  chartOfAccounts: 'Chart of Accounts',
});

function cashLines(count: number, safeType = 'Customer Collection') {
  return Array.from({ length: count }, (_, i) => ({
    id: `line-${i + 1}`,
    batchId: 'batch-1',
    data: {
      JournalBatchNumber: 'JN-6B08',
      JournalName: 'Cust-Pay',
      Description: 'Yard receipt',
      LineNumber: i + 1,
      SafeType: safeType,
    },
  }));
}

function build() {
  const handler = new PostCashBatchToDFOHandler(
    {} as never,
    {} as never,
    new CashJournalRoutingService(),
  ) as unknown as {
    mapToD365FOCashJournalRequests: (...args: unknown[]) => Array<{
      header: { JournalBatchNumber: string };
      lines: unknown[];
    }>;
    mapLines: (...args: unknown[]) => unknown[];
  };
  // Line mapping is covered elsewhere; here only the grouping is under test.
  jest
    .spyOn(handler, 'mapLines')
    .mockImplementation((lines: unknown) =>
      (lines as unknown[]).map(() => ({})),
    );
  return handler;
}

function groupsFor(count: number, safeType?: string) {
  const handler = build();
  const groups = new Map([['JN-6B08', cashLines(count, safeType)]]);
  return handler.mapToD365FOCashJournalRequests(
    groups,
    'm-p',
    'in',
    undefined,
    false,
    RUN,
  );
}

describe('Cash In journal size limit', () => {
  it('splits a journal larger than 1,000 lines into journals of at most 1,000', () => {
    const result = groupsFor(2500);
    expect(result.map((g) => g.lines.length)).toEqual([1000, 1000, 500]);
  });

  it('gives every part the same journal header', () => {
    const result = groupsFor(2500);
    expect(new Set(result.map((g) => g.header.JournalBatchNumber))).toEqual(
      new Set(['JN-6B08']),
    );
  });

  it('keeps a journal of exactly 1,000 lines as one journal', () => {
    expect(groupsFor(1000)).toHaveLength(1);
    expect(groupsFor(1000)[0].lines).toHaveLength(1000);
  });

  it('splits 1,089 lines into 1,000 and 89, and keeps 500 as one', () => {
    expect(groupsFor(1089)).toHaveLength(2);
    expect(groupsFor(500)).toHaveLength(1);
  });

  it('never splits a credit note settlement batch, whose pairs share one voucher', () => {
    const result = groupsFor(2500, CREDIT_NOTE_SETTLEMENT_SAFE_TYPE);
    expect(result).toHaveLength(1);
    expect(result[0].lines).toHaveLength(2500);
  });
});
