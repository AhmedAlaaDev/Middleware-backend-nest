import {
  buildCashInvoiceLines,
  buildCashLines,
} from '@/modules/cash/services/cash-line-building.service';
import { resolveCashInboundRates } from '@/modules/cash/services/cash-in-line-building.service';

describe('cash line building service', () => {
  it('uses the official D365 transaction rate for Cash-In when a rate context exists', () => {
    const context = {} as any;
    const resolveTransaction = jest.fn().mockReturnValue({
      kind: 'matched',
      rate: 4765,
    });
    const resolveReporting = jest.fn().mockReturnValue({
      kind: 'matched',
      rate: 1,
    });
    const fetchLegacyRates = jest.fn().mockReturnValue({
      exchangeRate: 100,
      reportingRate: 1,
    });

    const result = resolveCashInboundRates({
      exchangeRateContext: context,
      transactionDate: '2026-01-01',
      currencyCode: 'USD',
      resolveTransaction,
      resolveReporting,
      fetchLegacyRates,
    });

    expect(result).toEqual({ exchangeRate: 4765, reportingRate: 1 });
    expect(resolveTransaction).toHaveBeenCalledWith(
      context,
      '2026-01-01',
      'USD',
    );
    expect(fetchLegacyRates).not.toHaveBeenCalled();
  });

  it('keeps the legacy Cash-In rate lookup only when no official context exists', () => {
    const fetchLegacyRates = jest.fn().mockReturnValue({
      exchangeRate: 5580,
      reportingRate: 1.171038824764,
    });

    const result = resolveCashInboundRates({
      transactionDate: '2026-01-01',
      currencyCode: 'EUR',
      resolveTransaction: jest.fn(),
      resolveReporting: jest.fn(),
      fetchLegacyRates,
    });

    expect(result).toEqual({
      exchangeRate: 5580,
      reportingRate: 1.171038824764,
    });
    expect(fetchLegacyRates).toHaveBeenCalledWith('2026-01-01', 'EUR');
  });

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

  it('delegates all outbound feature routing to the Cash-Out builder', () => {
    const buildOutbound = jest.fn(() => ['vendor'] as any);
    const line = { SafeType: 'Vendor Payment', IsVendorPayment: true } as any;

    const result = buildCashLines({
      sourceId: 'invoice-1',
      lines: [line],
      inbound: false,
      buildOutbound,
      buildTwoLines: jest.fn(),
      buildManyLines: jest.fn(),
    });

    expect(result).toEqual(['vendor']);
    expect(buildOutbound).toHaveBeenCalledWith('invoice-1', [line], undefined);
  });
});
