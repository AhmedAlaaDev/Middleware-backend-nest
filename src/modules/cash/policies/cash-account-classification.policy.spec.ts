import {
  extractCashMainAccountToken,
  findCashBankMisclassificationError,
  isKnownCashLedgerMainAccount,
  resolveCashAccountType,
  validateCashLedgerAccountCurrency,
} from './cash-account-classification.policy';

describe('extractCashMainAccountToken', () => {
  it('returns the first pipe-delimited segment', () => {
    expect(extractCashMainAccountToken('125901|1301|013|001')).toBe('125901');
  });

  it('returns the whole trimmed value when there are no pipes', () => {
    expect(extractCashMainAccountToken(' 125901 ')).toBe('125901');
  });

  it('returns an empty string for undefined input', () => {
    expect(extractCashMainAccountToken(undefined)).toBe('');
  });
});

describe('isKnownCashLedgerMainAccount', () => {
  it('recognizes 125901 and 125902', () => {
    expect(isKnownCashLedgerMainAccount('125901')).toBe(true);
    expect(isKnownCashLedgerMainAccount('125902')).toBe(true);
  });

  it('does not recognize unrelated accounts', () => {
    expect(isKnownCashLedgerMainAccount('999999')).toBe(false);
  });
});

describe('resolveCashAccountType', () => {
  it('resolves 125901 as Ledger even when the source marks it Bank', () => {
    expect(resolveCashAccountType('125901', 'Bank')).toBe('Ledger');
  });

  it('resolves 125902 as Ledger even when the source marks it Bank', () => {
    expect(resolveCashAccountType('125902', 'Bank')).toBe('Ledger');
  });

  it('resolves a pipe-delimited 125901 dimension string as Ledger', () => {
    expect(resolveCashAccountType('125901|1301|013|001', 'Ledger')).toBe(
      'Ledger',
    );
  });

  it('passes through the source account type for unrelated accounts', () => {
    expect(resolveCashAccountType('POS-EG', 'Bank')).toBe('Bank');
    expect(resolveCashAccountType('101000151', 'Cust')).toBe('Cust');
  });
});

describe('validateCashLedgerAccountCurrency', () => {
  it('warns when 125901 is used with a currency other than USD', () => {
    expect(validateCashLedgerAccountCurrency('125901', 'EUR')).toBe(
      'Account 125901 is configured for USD but transaction currency is EUR.',
    );
  });

  it('does not warn when 125901 is used with USD', () => {
    expect(validateCashLedgerAccountCurrency('125901', 'USD')).toBeNull();
  });

  it('does not warn for accounts outside the configured list', () => {
    expect(validateCashLedgerAccountCurrency('999999', 'EUR')).toBeNull();
  });
});

describe('findCashBankMisclassificationError', () => {
  it('flags 125901 when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '125901')).toBe(
      'Main account 125901 was incorrectly resolved as a Bank account.',
    );
  });

  it('flags 125902 when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '125902')).toBe(
      'Main account 125902 was incorrectly resolved as a Bank account.',
    );
  });

  it('flags the settlement main account 421103 when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '421103|1301|013')).toBe(
      'Main account 421103 was incorrectly resolved as a Bank account.',
    );
  });

  it('does not flag a real Bank account', () => {
    expect(findCashBankMisclassificationError('Bank', 'POS-EG')).toBeNull();
  });

  it('does not flag a Ledger-resolved account', () => {
    expect(findCashBankMisclassificationError('Ledger', '125901')).toBeNull();
  });
});
