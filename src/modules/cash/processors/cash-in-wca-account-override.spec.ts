import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  findCashBankMisclassificationError,
  resolveCashAccountType,
  resolveWcaMainAccount,
} from '@/modules/cash/policies/cash-account-classification.policy';
import {
  findInvalidCashBankAccountDimensionValue,
  resolveCashOffsetAccountDisplayValue,
  sanitizeCashBankAccountDimension,
} from '@/modules/cash/policies/cash-dimension.policy';
import { CashIn421103CurrencyPolicy } from '@/modules/cash/policies/cash-in-421103-currency.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

describe('Integration Test — Cash-In WCA Account Overrides & Pre-Posting Invariants', () => {
  it('AC1, AC3, AC7, AC9: forces WCA-US (source type Bank) to Ledger 125901 and clears BankAccount dimension', () => {
    const rawLine = new CashEntryRawDataModel(
      {
        UniqueId: 500001,
        LINENUMBER: 1,
        VOUCHER: 'VOUCH-WCA-01',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'WCA-US',
        DEBITAMOUNT: 1000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
      } as any,
      'Freight',
      true,
    );

    // 1. Resolve account type
    const resolvedAccountType = resolveCashAccountType(
      rawLine.ACCOUNTDISPLAYVALUE,
      rawLine.ACCOUNTTYPE,
    );
    expect(resolvedAccountType).toBe('Ledger');

    // 2. Resolve main account number
    const resolvedMainAccount = resolveWcaMainAccount(rawLine.ACCOUNTDISPLAYVALUE);
    expect(resolvedMainAccount).toBe('125901');

    // 3. Pre-post check: findCashBankMisclassificationError must return null for Ledger
    expect(
      findCashBankMisclassificationError(
        resolvedAccountType,
        rawLine.ACCOUNTDISPLAYVALUE,
      ),
    ).toBeNull();

    // 4. Dimension sanitization: WCA-US in bankAccount dimension segment must be cleared
    const dimensions: EntryDimensionsModel = {
      mainAccount: '125901',
      bankAccount: 'WCA-US',
    } as any;

    const invalidValue = findInvalidCashBankAccountDimensionValue(dimensions);
    expect(invalidValue).toBe('WCA-US');

    const clearedValue = sanitizeCashBankAccountDimension(dimensions);
    expect(clearedValue).toBe('WCA-US');
    expect(dimensions.bankAccount).toBeUndefined();
  });

  it('AC2, AC4, AC8, AC10: forces WCA-EUR (source type Bank) to Ledger 125902 and clears BankAccount dimension', () => {
    const rawLine = new CashEntryRawDataModel(
      {
        UniqueId: 500002,
        LINENUMBER: 1,
        VOUCHER: 'VOUCH-WCA-02',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'WCA-EUR',
        DEBITAMOUNT: 500,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EUR',
        SafeType: 'Customer Collection',
      } as any,
      'Freight',
      true,
    );

    const resolvedAccountType = resolveCashAccountType(
      rawLine.ACCOUNTDISPLAYVALUE,
      rawLine.ACCOUNTTYPE,
    );
    expect(resolvedAccountType).toBe('Ledger');

    const resolvedMainAccount = resolveWcaMainAccount(rawLine.ACCOUNTDISPLAYVALUE);
    expect(resolvedMainAccount).toBe('125902');

    const dimensions: EntryDimensionsModel = {
      mainAccount: '125902',
      bankAccount: 'WCA-EUR',
    } as any;

    const clearedValue = sanitizeCashBankAccountDimension(dimensions);
    expect(clearedValue).toBe('WCA-EUR');
    expect(dimensions.bankAccount).toBeUndefined();
  });

  it('AC5 & AC6: handles offset account WCA-US and WCA-EUR correctly', () => {
    const offsetLineUS = new CashEntryRawDataModel(
      {
        UniqueId: 500003,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'WCA-US',
      } as any,
      'Freight',
      true,
    );

    const resolvedOffsetValueUS = resolveCashOffsetAccountDisplayValue(
      offsetLineUS,
      {} as any,
      false,
      'FALLBACK',
    );
    expect(resolvedOffsetValueUS).toBe('125901');

    const offsetLineEUR = new CashEntryRawDataModel(
      {
        UniqueId: 500004,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'WCA-EUR',
      } as any,
      'Freight',
      true,
    );

    const resolvedOffsetValueEUR = resolveCashOffsetAccountDisplayValue(
      offsetLineEUR,
      {} as any,
      false,
      'FALLBACK',
    );
    expect(resolvedOffsetValueEUR).toBe('125902');
  });

  it('AC12: leaves real configured Bank Accounts (e.g. POS-EG) unchanged as Bank', () => {
    const realBankLine = new CashEntryRawDataModel(
      {
        UniqueId: 500005,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'POS-EG',
      } as any,
      'Freight',
      true,
    );

    const resolvedAccountType = resolveCashAccountType(
      realBankLine.ACCOUNTDISPLAYVALUE,
      realBankLine.ACCOUNTTYPE,
    );
    expect(resolvedAccountType).toBe('Bank');
  });

  it('AC20: verifies 421103 currency-copy rule coexists cleanly and preserves amounts', () => {
    const customerLine = new CashEntryRawDataModel(
      {
        UniqueId: 500006,
        LINENUMBER: 1,
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'CUST-001',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1000,
        CURRENCYCODE: 'EGP',
      } as any,
      'Freight',
      true,
    );

    const ledger421103 = new CashEntryRawDataModel(
      {
        UniqueId: 500006,
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103',
        DEBITAMOUNT: 1000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
      } as any,
      'Freight',
      true,
    );

    const wcaLine = new CashEntryRawDataModel(
      {
        UniqueId: 500006,
        LINENUMBER: 3,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'WCA-US',
        DEBITAMOUNT: 1000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
      } as any,
      'Freight',
      true,
    );

    CashIn421103CurrencyPolicy.apply({
      uniqueId: 500006,
      safeType: 'Customer Collection',
      lines: [customerLine, ledger421103, wcaLine],
    });

    expect(customerLine.CURRENCYCODE).toBe('USD');
    expect(customerLine.CREDITAMOUNT).toBe(1000);
    expect(ledger421103.DEBITAMOUNT).toBe(1000);

    const wcaResolvedType = resolveCashAccountType(
      wcaLine.ACCOUNTDISPLAYVALUE,
      wcaLine.ACCOUNTTYPE,
    );
    expect(wcaResolvedType).toBe('Ledger');
    expect(resolveWcaMainAccount(wcaLine.ACCOUNTDISPLAYVALUE)).toBe('125901');
  });
});
