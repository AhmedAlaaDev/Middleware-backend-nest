import {
  buildCashInvoiceLines,
  buildCashLines,
} from '@/modules/cash/services/cash-line-building.service';

describe('cash line building service', () => {
  it('preserves grouped invoice order and concatenates each builder result', () => {
    const invoiceMap = new Map([
      ['first', []],
      ['second', []],
    ]);
    const calls: string[] = [];

    const result = buildCashInvoiceLines({
      invoiceMap,
      buildGroupedLines: (sourceId) => {
        calls.push(sourceId);
        return [{ sourceId } as any];
      },
    });

    expect(calls).toEqual(['first', 'second']);
    expect(result).toEqual([{ sourceId: 'first' }, { sourceId: 'second' }]);
  });

  it('keeps outbound vendor-payment routing delegated to the existing callback', () => {
    const buildVendorPayment = jest.fn(() => ['vendor'] as any);
    const buildSourceOutbound = jest.fn(() => 'source' as any);
    const line = { SafeType: 'Vendor Payment', IsVendorPayment: true } as any;

    const result = buildCashLines({
      sourceId: 'invoice-1',
      lines: [line],
      inbound: false,
      buildVendorPayment,
      buildSourceOutbound,
      buildTwoLines: jest.fn(),
      buildManyLines: jest.fn(),
    });

    expect(result).toEqual(['vendor']);
    expect(buildVendorPayment).toHaveBeenCalledWith(
      'invoice-1',
      [line],
      undefined,
    );
    expect(buildSourceOutbound).not.toHaveBeenCalled();
  });
});
