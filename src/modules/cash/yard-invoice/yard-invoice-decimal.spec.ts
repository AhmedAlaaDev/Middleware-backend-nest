import {
  microToString,
  numericValueToMicro,
  parseDecimalToMicro,
  roundMicroToCurrency,
  YardInvoiceDecimalError,
} from './yard-invoice-decimal';

describe('yard-invoice-decimal', () => {
  it('parses plain decimals to exact micro units', () => {
    expect(parseDecimalToMicro('1350.0001')).toBe(1350000100n);
    expect(parseDecimalToMicro(' 12 ')).toBe(12000000n);
    expect(parseDecimalToMicro('-2.5')).toBe(-2500000n);
  });

  it('rejects exponents, separators and more than six decimals', () => {
    expect(() => parseDecimalToMicro('1e3')).toThrow(YardInvoiceDecimalError);
    expect(() => parseDecimalToMicro('1,350.00')).toThrow(
      YardInvoiceDecimalError,
    );
    expect(() => parseDecimalToMicro('1.0000001')).toThrow(/decimal places/);
    expect(() => parseDecimalToMicro('')).toThrow(YardInvoiceDecimalError);
  });

  it('converts numeric cells without binary float drift', () => {
    expect(numericValueToMicro(0.3)).toBe(300000n);
    expect(numericValueToMicro(1350.0001)).toBe(1350000100n);
    expect(() => numericValueToMicro(1e-7)).toThrow(/exponent/);
  });

  it('formats with at least two decimals and no trailing noise', () => {
    expect(microToString(1350000100n)).toBe('1350.0001');
    expect(microToString(1500000n)).toBe('1.50');
    expect(microToString(-2000000n)).toBe('-2.00');
  });

  it('rounds half away from zero to the currency scale', () => {
    // 1350.0001 -> 1350.00 (variance 0.0001)
    const a = roundMicroToCurrency(1350000100n, 2);
    expect(a.rounded).toBe(1350000000n);
    // exact midpoint 1.005 -> 1.01
    expect(roundMicroToCurrency(1005000n, 2).rounded).toBe(1010000n);
    // 1.004999 -> 1.00
    expect(roundMicroToCurrency(1004999n, 2).rounded).toBe(1000000n);
    // JPY has no minor units
    expect(roundMicroToCurrency(1500000n, 0).rounded).toBe(2000000n);
  });

  it('rejects unsupported currency scales', () => {
    expect(() => roundMicroToCurrency(1n, 7)).toThrow(YardInvoiceDecimalError);
  });
});
