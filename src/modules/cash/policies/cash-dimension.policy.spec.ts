import {
  findInvalidCashBankAccountDimensionValue,
  normalizeCashCompositeDisplayValue,
  sanitizeCashBankAccountDimension,
} from './cash-dimension.policy';

describe('normalizeCashCompositeDisplayValue', () => {
  it('removes whitespace from internal dimension segments', () => {
    expect(
      normalizeCashCompositeDisplayValue(
        '124101|1602|016|001|003|201000283 |201000283 |3098',
      ),
    ).toBe('124101|1602|016|001|003|201000283|201000283|3098');
  });

  it('preserves spaces inside a plain account name', () => {
    expect(normalizeCashCompositeDisplayValue(' ALEXHO EG ')).toBe(
      'ALEXHO EG',
    );
  });
});

describe('findInvalidCashBankAccountDimensionValue', () => {
  it('flags a bankAccount segment that duplicates the main account', () => {
    expect(
      findInvalidCashBankAccountDimensionValue({
        mainAccount: '224209',
        bankAccount: '224209',
      } as any),
    ).toBe('224209');
  });

  it('flags 125901 even when it does not match the main account', () => {
    expect(
      findInvalidCashBankAccountDimensionValue({
        mainAccount: '421103',
        bankAccount: '125901',
      } as any),
    ).toBe('125901');
  });

  it('flags 125902 even when it does not match the main account', () => {
    expect(
      findInvalidCashBankAccountDimensionValue({
        mainAccount: '421103',
        bankAccount: '125902',
      } as any),
    ).toBe('125902');
  });

  it('does not flag a real bank account id', () => {
    expect(
      findInvalidCashBankAccountDimensionValue({
        mainAccount: '421103',
        bankAccount: 'POS-EG',
      } as any),
    ).toBe('');
  });

  it('does not flag an empty bankAccount segment', () => {
    expect(
      findInvalidCashBankAccountDimensionValue({
        mainAccount: '421103',
        bankAccount: '',
      } as any),
    ).toBe('');
  });
});

describe('sanitizeCashBankAccountDimension', () => {
  it('clears an invalid bankAccount segment and returns the previous value', () => {
    const dimensions = { mainAccount: '125901', bankAccount: '125901' } as any;

    const cleared = sanitizeCashBankAccountDimension(dimensions);

    expect(cleared).toBe('125901');
    expect(dimensions.bankAccount).toBeUndefined();
  });

  it('leaves a valid bankAccount segment untouched', () => {
    const dimensions = { mainAccount: '421103', bankAccount: 'POS-EG' } as any;

    const cleared = sanitizeCashBankAccountDimension(dimensions);

    expect(cleared).toBe('');
    expect(dimensions.bankAccount).toBe('POS-EG');
  });
});
