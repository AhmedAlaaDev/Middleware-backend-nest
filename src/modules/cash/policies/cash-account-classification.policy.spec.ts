import {
  extractCashMainAccountToken,
  findCashBankMisclassificationError,
  isKnownCashLedgerMainAccount,
  resolveCashAccountType,
  resolveWcaMainAccount,
  validateCashLedgerAccountCurrency,
} from './cash-account-classification.policy';

describe('extractCashMainAccountToken', () => {
  it('returns the first pipe-delimited segment', () => {
    expect(extractCashMainAccountToken('125901|1301|013|001')).toBe('125901');
  });

  it('returns WCA-US and WCA-EUR when provided directly or with whitespace/case', () => {
    expect(extractCashMainAccountToken('WCA-US')).toBe('WCA-US');
    expect(extractCashMainAccountToken(' wca-us ')).toBe('WCA-US');
    expect(extractCashMainAccountToken('WCA-EUR')).toBe('WCA-EUR');
    expect(extractCashMainAccountToken(' Wca-Eur ')).toBe('WCA-EUR');
  });

  it('returns the whole trimmed value when there are no pipes', () => {
    expect(extractCashMainAccountToken(' 125901 ')).toBe('125901');
  });

  it('returns an empty string for undefined input', () => {
    expect(extractCashMainAccountToken(undefined)).toBe('');
  });
});

describe('resolveWcaMainAccount', () => {
  it('resolves WCA-US to 125901 and WCA-EUR to 125902', () => {
    expect(resolveWcaMainAccount('WCA-US')).toBe('125901');
    expect(resolveWcaMainAccount('wca-us')).toBe('125901');
    expect(resolveWcaMainAccount('WCA-EUR')).toBe('125902');
    expect(resolveWcaMainAccount('wca-eur')).toBe('125902');
    expect(resolveWcaMainAccount('125901')).toBe('125901');
    expect(resolveWcaMainAccount('125902')).toBe('125902');
    expect(resolveWcaMainAccount('BANK-POS')).toBe('BANK-POS');
  });
});

describe('isKnownCashLedgerMainAccount', () => {
  it('recognizes WCA-US, WCA-EUR, 125901, and 125902', () => {
    expect(isKnownCashLedgerMainAccount('WCA-US')).toBe(true);
    expect(isKnownCashLedgerMainAccount('wca-us')).toBe(true);
    expect(isKnownCashLedgerMainAccount('WCA-EUR')).toBe(true);
    expect(isKnownCashLedgerMainAccount('wca-eur')).toBe(true);
    expect(isKnownCashLedgerMainAccount('125901')).toBe(true);
    expect(isKnownCashLedgerMainAccount('125902')).toBe(true);
  });

  it('does not recognize unrelated accounts', () => {
    expect(isKnownCashLedgerMainAccount('999999')).toBe(false);
  });
});

describe('resolveCashAccountType', () => {
  it('AC1 & AC3: resolves WCA-US as Ledger even when source marks it Bank', () => {
    expect(resolveCashAccountType('WCA-US', 'Bank')).toBe('Ledger');
    expect(resolveCashAccountType('wca-us', 'Bank')).toBe('Ledger');
    expect(resolveCashAccountType(' WCA-US ', 'Bank')).toBe('Ledger');
  });

  it('AC2 & AC4: resolves WCA-EUR as Ledger even when source marks it Bank', () => {
    expect(resolveCashAccountType('WCA-EUR', 'Bank')).toBe('Ledger');
    expect(resolveCashAccountType('wca-eur', 'Bank')).toBe('Ledger');
    expect(resolveCashAccountType(' WCA-EUR ', 'Bank')).toBe('Ledger');
  });

  it('resolves 125901 and 125902 as Ledger even when the source marks it Bank', () => {
    expect(resolveCashAccountType('125901', 'Bank')).toBe('Ledger');
    expect(resolveCashAccountType('125902', 'Bank')).toBe('Ledger');
  });

  it('resolves a pipe-delimited 125901 dimension string as Ledger', () => {
    expect(resolveCashAccountType('125901|1301|013|001', 'Ledger')).toBe(
      'Ledger',
    );
  });

  it('passes through the source account type for real Bank accounts', () => {
    expect(resolveCashAccountType('POS-EG', 'Bank')).toBe('Bank');
    expect(resolveCashAccountType('101000151', 'Cust')).toBe('Cust');
  });
});

describe('validateCashLedgerAccountCurrency', () => {
  it('warns when WCA-US / 125901 is used with a currency other than USD', () => {
    expect(validateCashLedgerAccountCurrency('WCA-US', 'EUR')).toBe(
      'Account WCA-US is configured for USD but transaction currency is EUR.',
    );
    expect(validateCashLedgerAccountCurrency('125901', 'EUR')).toBe(
      'Account 125901 is configured for USD but transaction currency is EUR.',
    );
  });

  it('does not warn when WCA-US / 125901 is used with USD', () => {
    expect(validateCashLedgerAccountCurrency('WCA-US', 'USD')).toBeNull();
    expect(validateCashLedgerAccountCurrency('125901', 'USD')).toBeNull();
  });

  it('warns when WCA-EUR / 125902 is used with a currency other than EUR', () => {
    expect(validateCashLedgerAccountCurrency('WCA-EUR', 'USD')).toBe(
      'Account WCA-EUR is configured for EUR but transaction currency is USD.',
    );
  });

  it('does not warn for accounts outside the configured list', () => {
    expect(validateCashLedgerAccountCurrency('999999', 'EUR')).toBeNull();
  });
});

describe('findCashBankMisclassificationError', () => {
  it('flags WCA-US and WCA-EUR when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', 'WCA-US')).toContain(
      'must be mapped as Ledger, not Bank',
    );
    expect(findCashBankMisclassificationError('Bank', 'wca-us')).toContain(
      'must be mapped as Ledger, not Bank',
    );
    expect(findCashBankMisclassificationError('Bank', 'WCA-EUR')).toContain(
      'must be mapped as Ledger, not Bank',
    );
  });

  it('flags 125901 and 125902 when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '125901')).toContain(
      'must be mapped as Ledger, not Bank',
    );
    expect(findCashBankMisclassificationError('Bank', '125902')).toContain(
      'must be mapped as Ledger, not Bank',
    );
  });

  it('flags the settlement main account 421103 when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '421103|1301|013')).toContain(
      'must be mapped as Ledger, not Bank',
    );
  });

  it('does not flag Notes Receivable main accounts (122201-122204) when resolved as Bank', () => {
    expect(findCashBankMisclassificationError('Bank', '122201')).toBeNull();
    expect(findCashBankMisclassificationError('Bank', '122202')).toBeNull();
  });

  it('does not flag a real Bank account', () => {
    expect(findCashBankMisclassificationError('Bank', 'POS-EG')).toBeNull();
  });

  it('does not flag a Ledger-resolved account', () => {
    expect(findCashBankMisclassificationError('Ledger', 'WCA-US')).toBeNull();
    expect(findCashBankMisclassificationError('Ledger', '125901')).toBeNull();
  });
});
