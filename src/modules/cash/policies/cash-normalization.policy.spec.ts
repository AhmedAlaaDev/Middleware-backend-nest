import { mapCashRawData } from './cash-normalization.policy';

describe('cash-normalization.policy', () => {
  it('preserves source order and applies the explicit product/direction context', () => {
    const first = { VOUCHER: 'V1', LINENUMBER: 1 } as any;
    const second = { VOUCHER: 'V2', LINENUMBER: 2 } as any;

    const result = mapCashRawData([first, second], 'Fleet', false);

    expect(result).toHaveLength(2);
    expect(result[0].VOUCHER).toBe('V1');
    expect(result[1].VOUCHER).toBe('V2');
    expect(result[0].SafeTransaction).toBe('Out');
  });
});
