import {
  assignCashMissingUniqueIds,
  classifyCashLines,
} from './cash-batch.policy';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

const line = (overrides: Partial<CashEntryRawDataModel> = {}) =>
  ({
    UniqueId: 0,
    VOUCHER: '',
    IsCustodySettlement: false,
    ...overrides,
  }) as CashEntryRawDataModel;

describe('cash-batch.policy', () => {
  it('assigns the same generated ID to lines sharing a voucher', () => {
    const lines = [
      line({ VOUCHER: 'V1' }),
      line({ VOUCHER: 'V1' }),
      line({ VOUCHER: 'V2' }),
    ];

    const result = assignCashMissingUniqueIds(lines);

    expect(lines.map(({ UniqueId }) => UniqueId)).toEqual([1, 1, 2]);
    expect(result).toEqual({ assignedLineCount: 3, voucherCount: 2 });
  });

  it('keeps existing IDs unchanged', () => {
    const lines = [line({ UniqueId: 44, VOUCHER: 'V1' })];

    expect(assignCashMissingUniqueIds(lines)).toEqual({
      assignedLineCount: 0,
      voucherCount: 0,
    });
    expect(lines[0].UniqueId).toBe(44);
  });

  it('splits Cash-In custody settlements while preserving order', () => {
    const settlement = line({ IsCustodySettlement: true });
    const ordinary = line();
    const result = classifyCashLines([settlement, ordinary], true);

    expect(result.custodySettlementLines).toEqual([settlement]);
    expect(result.otherLines).toEqual([ordinary]);
    expect(result.vendorPayment).toEqual([]);
  });

  it('keeps every Cash-Out line on the ordinary path', () => {
    const lines = [line({ IsCustodySettlement: true }), line()];

    expect(classifyCashLines(lines, false)).toEqual({
      custodySettlementLines: [],
      otherLines: lines,
      vendorPayment: [],
    });
  });
});
