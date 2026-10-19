import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  applyCashOutCustomerPaymentOffset,
  retargetCashOutCustomerPettyCashToCustodySettlement,
} from './cash-out-customer-payment-offset.policy';

function rawLine(data: Record<string, unknown>): CashEntryRawDataModel {
  return new CashEntryRawDataModel(data as any, 'Freight', false);
}

describe('applyCashOutCustomerPaymentOffset', () => {
  const customer = (overrides: Record<string, unknown> = {}) =>
    rawLine({
      UniqueId: 485664,
      LINENUMBER: 1,
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101000997',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1301|013|001|001|101000997|101000997||||3042|3208|Collect|||IMPORT||||',
      DEBITAMOUNT: 1710,
      CREDITAMOUNT: 0,
      OFFSETACCOUNTTYPE: '',
      OFFSETACCOUNTDISPLAYVALUE: '',
      SafeType: 'DownPayment',
      VoucherType: 'Cash',
      DESCRIPTION: 'CashOut - ALEXHO EG-754',
      ...overrides,
    });

  const pettyCash = () =>
    rawLine({
      UniqueId: 485664,
      LINENUMBER: 2,
      ACCOUNTTYPE: 'Petty cash',
      ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1301|013|001|001|101000997|101000997||||3042|3208|Collect|||IMPORT||||',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 1710,
      OFFSETACCOUNTTYPE: '',
      OFFSETACCOUNTDISPLAYVALUE: '',
      SafeType: 'DownPayment',
      VoucherType: 'Cash',
      DESCRIPTION: 'CashOut - ALEXHO EG-754',
    });

  const bank = () =>
    rawLine({
      UniqueId: 485664,
      LINENUMBER: 2,
      ACCOUNTTYPE: 'Bank',
      ACCOUNTDISPLAYVALUE: 'CIB-EG-CA',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1301|013|001|001|101000997|101000997||||3042|3208|Collect|||IMPORT||||',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 1710,
      OFFSETACCOUNTTYPE: '',
      OFFSETACCOUNTDISPLAYVALUE: '',
      SafeType: 'DownPayment',
      VoucherType: 'Cash',
    });

  it('does not put petty cash on the customer offset', () => {
    const customerLine = customer();
    const cashLine = pettyCash();
    const result = applyCashOutCustomerPaymentOffset([customerLine, cashLine]);

    expect(result).toEqual([customerLine, cashLine]);
    expect(result[0].OFFSETACCOUNTDISPLAYVALUE).toBe('');
  });

  it('puts a bank account on the customer offset and drops the bank row', () => {
    const customerLine = customer();
    const result = applyCashOutCustomerPaymentOffset([customerLine, bank()]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(customerLine);
    expect(result[0].OFFSETACCOUNTTYPE).toBe('Bank');
    expect(result[0].OFFSETACCOUNTDISPLAYVALUE).toBe('CIB-EG-CA');
  });

  it('does not pair Direct two-line journals', () => {
    const lines = [
      rawLine({
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223404',
        DEBITAMOUNT: 100,
        SafeType: 'Direct',
      }),
      rawLine({
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'AAIB-EG-CA',
        CREDITAMOUNT: 100,
        SafeType: 'Direct',
      }),
    ];

    expect(applyCashOutCustomerPaymentOffset(lines)).toEqual(lines);
  });

  it('does not pair a lone customer line', () => {
    const lines = [customer()];
    expect(applyCashOutCustomerPaymentOffset(lines)).toEqual(lines);
  });
});

describe('retargetCashOutCustomerPettyCashToCustodySettlement', () => {
  it('retargets a DownPayment customer debit + petty-cash credit', () => {
    const customerLine = rawLine({
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101000997',
      DEBITAMOUNT: 1710,
      CREDITAMOUNT: 0,
      SafeType: 'DownPayment',
    });
    const pettyCashLine = rawLine({
      ACCOUNTTYPE: 'Petty cash',
      ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 1710,
      SafeType: 'DownPayment',
    });

    expect(
      retargetCashOutCustomerPettyCashToCustodySettlement([
        customerLine,
        pettyCashLine,
      ]),
    ).toBe(true);
    expect(customerLine.SafeType).toBe('Custody Settlement');
    expect(customerLine.IsCustodySettlement).toBe(true);
    expect(pettyCashLine.SafeType).toBe('Custody Settlement');
    expect(pettyCashLine.IsCustodySettlement).toBe(true);
  });

  it('does not retarget a bank pair', () => {
    const lines = [
      rawLine({
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101000997',
        DEBITAMOUNT: 1710,
        SafeType: 'DownPayment',
      }),
      rawLine({
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'CIB-EG-CA',
        CREDITAMOUNT: 1710,
        SafeType: 'DownPayment',
      }),
    ];

    expect(retargetCashOutCustomerPettyCashToCustodySettlement(lines)).toBe(
      false,
    );
    expect(lines[0].SafeType).toBe('DownPayment');
  });
});
