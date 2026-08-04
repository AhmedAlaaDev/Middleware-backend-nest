import { EntryProcessorUtilsService } from './entry-processor-utils.service';

import { EntryDynDataModel } from '@/modules/entry-processor/models';

type CashBatchLine = EntryDynDataModel & {
  VoucherType?: string;
  TransactionDate?: string;
};

describe('EntryProcessorUtilsService.updateCashBatchAndVoucher', () => {
  const service = new EntryProcessorUtilsService();

  const buildLine = (
    uniqueId: string,
    options: {
      voucherType?: string;
      journalName?: string;
      transactionDate?: string;
    } = {},
  ): CashBatchLine =>
    ({
      SourceIds: [uniqueId],
      VoucherType: options.voucherType ?? 'Cash',
      JournalName: options.journalName ?? 'CashOut',
      TransactionDate: options.transactionDate ?? '2026-01-15',
      JournalBatchNumber: '',
      Voucher: '',
      LineNumber: 0,
    }) as unknown as CashBatchLine;

  const process = (lines: CashBatchLine[]) =>
    service.updateCashBatchAndVoucher({
      lines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
    });

  it('separates Cash, Cheque, and Other voucher buckets while grouping all Other types', () => {
    const result = process([
      buildLine('transfer', { voucherType: 'Transfer' }),
      buildLine('cash', { voucherType: 'Cash' }),
      buildLine('visa', { voucherType: 'Visa' }),
      buildLine('cheque', { voucherType: 'Cheque' }),
      buildLine('pos', { voucherType: 'POS' }),
    ]);

    expect(result.map((line) => line.SourceIds[0])).toEqual([
      'cash',
      'cheque',
      'transfer',
      'visa',
      'pos',
    ]);

    const batches = Object.fromEntries(
      result.map((line) => [line.SourceIds[0], line.JournalBatchNumber]),
    );

    expect(batches.cash).toBe('Mesco-000000001');
    expect(batches.cheque).toBe('Mesco-000000002');
    expect(batches.transfer).toBe('Mesco-000000003');
    expect(batches.visa).toBe(batches.transfer);
    expect(batches.pos).toBe(batches.transfer);
  });

  it('keeps different UniqueIds in the same batch when their bucket, route, and month match', () => {
    const result = process([
      buildLine('cash-1'),
      buildLine('cash-2'),
      buildLine('cash-3'),
    ]);

    expect(new Set(result.map((line) => line.JournalBatchNumber))).toEqual(
      new Set(['Mesco-000000001']),
    );
    expect(result.map((line) => line.Voucher)).toEqual([
      'CashOut-000000001',
      'CashOut-000000002',
      'CashOut-000000003',
    ]);
    expect(result.map((line) => line.LineNumber)).toEqual([1, 2, 3]);
  });

  it('starts a new batch when JournalName changes within the same bucket and month', () => {
    const result = process([
      buildLine('freight', { journalName: 'P-Freight' }),
      buildLine('fleet', { journalName: 'P-Fleet' }),
    ]);

    expect(result[0].JournalBatchNumber).toBe('Mesco-000000001');
    expect(result[1].JournalBatchNumber).toBe('Mesco-000000002');
    expect(result.map((line) => line.Voucher)).toEqual([
      'P-Freight-000000001',
      'P-Fleet-000000002',
    ]);
    expect(result.map((line) => line.LineNumber)).toEqual([1, 1]);
  });

  it('consolidates interleaved groups for the same route instead of creating A/B/A batches', () => {
    const result = process([
      buildLine('cashout-1', { journalName: 'CashOut' }),
      buildLine('cust-pay', { journalName: 'Cust-Pay' }),
      buildLine('cashout-2', { journalName: 'cashout' }),
    ]);

    expect(result.map((line) => line.SourceIds[0])).toEqual([
      'cashout-1',
      'cashout-2',
      'cust-pay',
    ]);
    expect(result.map((line) => line.JournalBatchNumber)).toEqual([
      'Mesco-000000001',
      'Mesco-000000001',
      'Mesco-000000002',
    ]);
    expect(result.map((line) => line.LineNumber)).toEqual([1, 2, 1]);
  });

  it('consolidates an interleaved route separately for each calendar month', () => {
    const result = process([
      buildLine('cashout-jan-1', {
        journalName: 'CashOut',
        transactionDate: '2026-01-05',
      }),
      buildLine('cashout-feb', {
        journalName: 'CashOut',
        transactionDate: '2026-02-05',
      }),
      buildLine('cashout-jan-2', {
        journalName: 'CashOut',
        transactionDate: '2026-01-20',
      }),
    ]);

    expect(result.map((line) => line.SourceIds[0])).toEqual([
      'cashout-jan-1',
      'cashout-jan-2',
      'cashout-feb',
    ]);
    expect(result.map((line) => line.JournalBatchNumber)).toEqual([
      'Mesco-000000001',
      'Mesco-000000001',
      'Mesco-000000002',
    ]);
  });

  it('starts a new batch at a calendar-month boundary', () => {
    const result = process([
      buildLine('january', { transactionDate: '2026-01-31' }),
      buildLine('february', { transactionDate: '2026-02-01' }),
    ]);

    expect(result.map((line) => line.JournalBatchNumber)).toEqual([
      'Mesco-000000001',
      'Mesco-000000002',
    ]);
    expect(result.map((line) => line.LineNumber)).toEqual([1, 1]);
  });

  it('starts a new batch after exactly 1,000 lines', () => {
    const firstThousand = Array.from({ length: 1000 }, (_, index) =>
      buildLine(`line-${index + 1}`),
    );

    const result = process([...firstThousand, buildLine('line-1001')]);

    expect(result[999].JournalBatchNumber).toBe('Mesco-000000001');
    expect(result[999].LineNumber).toBe(1000);
    expect(result[1000].JournalBatchNumber).toBe('Mesco-000000002');
    expect(result[1000].LineNumber).toBe(1);
  });

  it('moves a whole UniqueId group to the next batch instead of splitting it at 1,000 lines', () => {
    const firstNineHundredNinetyNine = Array.from({ length: 999 }, (_, index) =>
      buildLine(`line-${index + 1}`),
    );
    const groupedLines = [buildLine('atomic'), buildLine('atomic')];

    const result = process([...firstNineHundredNinetyNine, ...groupedLines]);
    const atomicResult = result.filter(
      (line) => line.SourceIds[0] === 'atomic',
    );

    expect(result[998].JournalBatchNumber).toBe('Mesco-000000001');
    expect(result[998].LineNumber).toBe(999);
    expect(atomicResult).toHaveLength(2);
    expect(
      new Set(atomicResult.map((line) => line.JournalBatchNumber)),
    ).toEqual(new Set(['Mesco-000000002']));
    expect(new Set(atomicResult.map((line) => line.Voucher))).toEqual(
      new Set(['CashOut-000001000']),
    );
    expect(atomicResult.map((line) => line.LineNumber)).toEqual([1, 2]);
  });
});

describe('EntryProcessorUtilsService dimension display padding', () => {
  const service = new EntryProcessorUtilsService();

  it('detects and trims padded dimension segments used by FO ledger accounts', () => {
    const padded =
      '511505|1302|013|001|001|101008962 |101008962 |||16433|3076|3208|Collect|||IMPORT||||';

    expect(service.findPaddedDimensionSegments(padded)).toEqual([
      { index: 5, raw: '101008962 ', trimmed: '101008962' },
      { index: 6, raw: '101008962 ', trimmed: '101008962' },
    ]);
    expect(service.trimDimensionDisplaySegments(padded)).toBe(
      '511505|1302|013|001|001|101008962|101008962|||16433|3076|3208|Collect|||IMPORT||||',
    );
    expect(service.findPaddedDimensionSegments('BANK PSD EG')).toEqual([]);
  });
});
