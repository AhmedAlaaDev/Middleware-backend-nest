import { BadRequestException } from '@nestjs/common';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  CashIn421103CurrencyPolicy,
  is421103Account,
} from './cash-in-421103-currency.policy';

describe('CashIn421103CurrencyPolicy', () => {
  describe('is421103Account helper', () => {
    it('correctly identifies main account 421103 with or without dimensions', () => {
      expect(is421103Account('421103')).toBe(true);
      expect(is421103Account('421103-BU01')).toBe(true);
      expect(is421103Account('421103-BU01-CC02')).toBe(true);
      expect(is421103Account('421103|1301|013')).toBe(true);
      expect(is421103Account('125901')).toBe(false);
      expect(is421103Account('421104')).toBe(false);
      expect(is421103Account(undefined)).toBe(false);
    });
  });

  describe('Unit tests for 421103 Currency Rule', () => {
    // 1. Customer EGP + 421103 USD -> Customer becomes USD.
    it('AC1: updates Customer credit currency from EGP to USD from 421103 Ledger line', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500001,
          LINENUMBER: 1,
          VOUCHER: 'V-001',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'CUST-001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500001,
          LINENUMBER: 2,
          VOUCHER: 'V-001',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500001,
        safeType: 'Customer Collection',
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('USD');
      expect(customerLine.CREDITAMOUNT).toBe(1000);
      expect(ledgerLine.DEBITAMOUNT).toBe(1000);
      expect(ledgerLine.CURRENCYCODE).toBe('USD');
    });

    // 2. Customer EGP + 421103 EUR -> Customer becomes EUR.
    it('AC3: updates Customer credit currency from EGP to EUR', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500002,
          LINENUMBER: 1,
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'CUST-002',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 500,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500002,
          LINENUMBER: 2,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103-BU01',
          DEBITAMOUNT: 500,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EUR',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500002,
        safeType: 'Customer Collection',
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('EUR');
      expect(customerLine.CREDITAMOUNT).toBe(500);
      expect(ledgerLine.DEBITAMOUNT).toBe(500);
    });

    // 3. Customer USD + 421103 USD -> Customer remains USD.
    it('AC4: leaves Customer currency unchanged if both are already USD', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500003,
          LINENUMBER: 1,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 500,
          CURRENCYCODE: 'USD',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500003,
          LINENUMBER: 2,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 500,
          CURRENCYCODE: 'USD',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500003,
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('USD');
      expect(customerLine.CREDITAMOUNT).toBe(500);
    });

    // 4 & 5 & 6. Customer and 421103 amounts are different -> amounts remain unchanged.
    it('AC2 & AC6: preserves original amounts when Customer and 421103 amounts differ', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500004,
          LINENUMBER: 1,
          ACCOUNTTYPE: 'Cust',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 950,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500004,
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

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500004,
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('USD');
      expect(customerLine.CREDITAMOUNT).toBe(950); // Original 950 preserved
      expect(customerLine.DEBITAMOUNT).toBe(0);
      expect(ledgerLine.DEBITAMOUNT).toBe(1000); // Original 1000 preserved
      expect(ledgerLine.CREDITAMOUNT).toBe(0);
    });

    // 7. 421103 line remains in the transaction.
    it('AC5: preserves 421103 line in the group after applying currency rule', () => {
      const groupLines = [
        new CashEntryRawDataModel(
          {
            UniqueId: 500005,
            LINENUMBER: 1,
            ACCOUNTTYPE: 'Cust',
            CREDITAMOUNT: 1000,
            CURRENCYCODE: 'EGP',
          } as any,
          'Freight',
          true,
        ),
        new CashEntryRawDataModel(
          {
            UniqueId: 500005,
            LINENUMBER: 2,
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '421103',
            DEBITAMOUNT: 1000,
            CURRENCYCODE: 'USD',
          } as any,
          'Freight',
          true,
        ),
      ];

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500005,
        lines: groupLines,
      });

      expect(groupLines).toHaveLength(2);
      expect(groupLines[1].ACCOUNTDISPLAYVALUE).toBe('421103');
    });

    // 8. No 421103 line -> rule does nothing.
    it('AC10: does nothing if no 421103 line exists in group', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500006,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500006,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '125901',
          DEBITAMOUNT: 1000,
          CURRENCYCODE: 'USD',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500006,
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('EGP');
    });

    // 9. Missing 421103 CurrencyCode -> validation error.
    it('AC11: throws BadRequestException if matched 421103 line has no currency', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500007,
          LINENUMBER: 1,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500007,
          LINENUMBER: 2,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 1000,
          CURRENCYCODE: '',
        } as any,
        'Freight',
        true,
      );

      expect(() =>
        CashIn421103CurrencyPolicy.apply({
          uniqueId: 500007,
          lines: [customerLine, ledgerLine],
        }),
      ).toThrow(BadRequestException);
    });

    // 10. Multiple 421103 lines -> correct one is selected by Voucher.
    it('AC12: deterministically matches multiple 421103 lines using Voucher', () => {
      const custLine1 = new CashEntryRawDataModel(
        {
          UniqueId: 500008,
          LINENUMBER: 1,
          VOUCHER: 'VOUCH-A',
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerA = new CashEntryRawDataModel(
        {
          UniqueId: 500008,
          LINENUMBER: 2,
          VOUCHER: 'VOUCH-A',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'USD',
        } as any,
        'Freight',
        true,
      );

      const ledgerB = new CashEntryRawDataModel(
        {
          UniqueId: 500008,
          LINENUMBER: 3,
          VOUCHER: 'VOUCH-B',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 200,
          CURRENCYCODE: 'EUR',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500008,
        lines: [custLine1, ledgerA, ledgerB],
      });

      expect(custLine1.CURRENCYCODE).toBe('USD');
    });

    // 11. Ambiguous 421103 matching -> validation error.
    it('AC12: throws BadRequestException when multiple 421103 lines cannot be deterministically matched', () => {
      const custLine1 = new CashEntryRawDataModel(
        {
          UniqueId: 500009,
          LINENUMBER: 1,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const custLine2 = new CashEntryRawDataModel(
        {
          UniqueId: 500009,
          LINENUMBER: 2,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 200,
          CURRENCYCODE: 'EGP',
        } as any,
        'Freight',
        true,
      );

      const ledgerA = new CashEntryRawDataModel(
        {
          UniqueId: 500009,
          LINENUMBER: 3,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'USD',
        } as any,
        'Freight',
        true,
      );

      const ledgerB = new CashEntryRawDataModel(
        {
          UniqueId: 500009,
          LINENUMBER: 4,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 200,
          CURRENCYCODE: 'EUR',
        } as any,
        'Freight',
        true,
      );

      expect(() =>
        CashIn421103CurrencyPolicy.apply({
          uniqueId: 500009,
          lines: [custLine1, custLine2, ledgerA, ledgerB],
        }),
      ).toThrow(BadRequestException);
    });

    // 13. Custody Settlement -> rule is not executed.
    it('AC9: skips execution for Custody Settlement groups', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500010,
          ACCOUNTTYPE: 'Cust',
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          SafeType: 'Custody Settlement',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500010,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 1000,
          CURRENCYCODE: 'USD',
          SafeType: 'Custody Settlement',
        } as any,
        'Freight',
        true,
      );

      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500010,
        safeType: 'Custody Settlement',
        lines: [customerLine, ledgerLine],
      });

      expect(customerLine.CURRENCYCODE).toBe('EGP');
    });
  });

  describe('Integration Test — End to End 421103 Currency Rule', () => {
    it('preserves amounts 16823.04 exactly while copying USD currency to Customer credit line', () => {
      const customerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500001,
          LINENUMBER: 1,
          VOUCHER: 'VOUCH-16823',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'CUST-REC-01',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 16823.04,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
        } as any,
        'Freight',
        true,
      );

      const ledgerLine = new CashEntryRawDataModel(
        {
          UniqueId: 500001,
          LINENUMBER: 2,
          VOUCHER: 'VOUCH-16823',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 16823.04,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
        } as any,
        'Freight',
        true,
      );

      // Execute CashIn421103CurrencyPolicy
      CashIn421103CurrencyPolicy.apply({
        uniqueId: 500001,
        safeType: 'Customer Collection',
        lines: [customerLine, ledgerLine],
      });

      // Assert Customer line: Currency = USD, CreditAmount = 16823.04 (unchanged)
      expect(customerLine.CURRENCYCODE).toBe('USD');
      expect(customerLine.CREDITAMOUNT).toBe(16823.04);
      expect(customerLine.DEBITAMOUNT).toBe(0);

      // Assert 421103 line: Currency = USD, DebitAmount = 16823.04 (unchanged)
      expect(ledgerLine.CURRENCYCODE).toBe('USD');
      expect(ledgerLine.DEBITAMOUNT).toBe(16823.04);
      expect(ledgerLine.CREDITAMOUNT).toBe(0);
    });
  });
});
