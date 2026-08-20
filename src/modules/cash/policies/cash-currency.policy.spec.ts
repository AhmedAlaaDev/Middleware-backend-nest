import { resolveCashInboundCustomerCurrency } from './cash-currency.policy';

describe('resolveCashInboundCustomerCurrency', () => {
  it('aligns the customer currency with the paired non-customer line when they differ', () => {
    const result = resolveCashInboundCustomerCurrency(
      { CURRENCYCODE: 'EGP' } as any,
      { CURRENCYCODE: 'USD' } as any,
    );

    expect(result.currencyCode).toBe('USD');
    expect(result.changed).toBe(true);
    expect(result.previousCurrencyCode).toBe('EGP');
  });

  it('does nothing when both currencies already match', () => {
    const result = resolveCashInboundCustomerCurrency(
      { CURRENCYCODE: 'USD' } as any,
      { CURRENCYCODE: 'USD' } as any,
    );

    expect(result.currencyCode).toBe('USD');
    expect(result.changed).toBe(false);
    expect(result.previousCurrencyCode).toBe('USD');
  });

  it('aligns to the non-customer currency even when it differs from another foreign currency', () => {
    const result = resolveCashInboundCustomerCurrency(
      { CURRENCYCODE: 'USD' } as any,
      { CURRENCYCODE: 'EUR' } as any,
    );

    expect(result.currencyCode).toBe('EUR');
    expect(result.changed).toBe(true);
    expect(result.previousCurrencyCode).toBe('USD');
  });

  it('keeps the customer currency when the non-customer line has no currency', () => {
    const result = resolveCashInboundCustomerCurrency(
      { CURRENCYCODE: 'EGP' } as any,
      { CURRENCYCODE: '' } as any,
    );

    expect(result.currencyCode).toBe('EGP');
    expect(result.changed).toBe(false);
    expect(result.previousCurrencyCode).toBe('EGP');
  });
});
