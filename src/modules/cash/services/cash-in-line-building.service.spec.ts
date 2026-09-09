import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  formatCashInboundDescription,
  resolveCashInboundPaymentReference,
} from '@/modules/cash/services/cash-in-line-building.service';

describe('resolveCashInboundPaymentReference', () => {
  const customerLine = (overrides: Record<string, unknown> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 1,
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101000867',
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'DownPayment',
        VoucherType: 'Deposit',
        ...overrides,
      } as any,
      'Freight',
      true,
    );

  const offsetLine = (overrides: Record<string, unknown> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'CIB-EG-CA',
        DESCRIPTION: 'BankIn - CIB_EG_CA-338',
        DEBITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'DownPayment',
        VoucherType: 'Deposit',
        ...overrides,
      } as any,
      'Freight',
      true,
    );

  it('keeps the bank payment reference instead of the offset account description', () => {
    expect(
      resolveCashInboundPaymentReference({
        accountLine: customerLine({ PAYMENTREFERENCE: 'FT26060B54Z5' }),
        offsetLine: offsetLine({ PAYMENTREFERENCE: 'FT26060B54Z5' }),
      }),
    ).toBe('FT26060B54Z5');
  });

  it('uses the customer-row payment reference when the offset row has none', () => {
    expect(
      resolveCashInboundPaymentReference({
        accountLine: customerLine({ PAYMENTREFERENCE: 'FT26060B54Z5' }),
        offsetLine: offsetLine({ PAYMENTREFERENCE: '' }),
      }),
    ).toBe('FT26060B54Z5');
  });

  it('does not invent a DESCRIPTION - Freight payment reference when the source has none', () => {
    const inbound = offsetLine({ PAYMENTREFERENCE: '' });
    const outbound = new CashEntryRawDataModel(
      {
        DESCRIPTION: 'CashOut - ALEXHO EG-1',
        PAYMENTREFERENCE: '',
        ACCOUNTTYPE: 'Vend',
      } as any,
      'Freight',
      false,
    );

    expect(inbound.PAYMENTREFERENCE).toBe('');
    expect(outbound.PAYMENTREFERENCE).toBe('');
    expect(
      resolveCashInboundPaymentReference({
        accountLine: customerLine({ PAYMENTREFERENCE: '' }),
        offsetLine: inbound,
      }),
    ).toBe('');
  });

  it('treats placeholder payment references as empty', () => {
    expect(
      new CashEntryRawDataModel(
        { PAYMENTREFERENCE: '0', DESCRIPTION: 'BankIn - CIB_EG_CA-338' } as any,
        'Freight',
        true,
      ).PAYMENTREFERENCE,
    ).toBe('');
  });

  it('does not put the formatted customer-collection text into PaymentReference', () => {
    const { description, paymentReference } = formatCashInboundDescription({
      accountLine: customerLine({ PAYMENTREFERENCE: 'FT26060B54Z5' }),
      offsetLine: offsetLine({ PAYMENTREFERENCE: 'FT26060B54Z5' }),
      isNotesReceivable: false,
      label: 'Freight',
      formattedDate: 'Jan 2026',
    });

    expect(paymentReference).toBe('FT26060B54Z5');
    expect(description).toContain('Customer Collection');
    expect(paymentReference).not.toBe(description);
    expect(paymentReference).not.toBe('CIB-EG-CA');
    expect(paymentReference).not.toBe('BankIn - CIB_EG_CA-338');
    expect(paymentReference).not.toContain(' - Freight');
  });

  it('does not invent a notes-receivable DESCRIPTION - Freight payment reference', () => {
    const { paymentReference } = formatCashInboundDescription({
      accountLine: customerLine({ PAYMENTREFERENCE: '' }),
      offsetLine: offsetLine({ PAYMENTREFERENCE: '' }),
      isNotesReceivable: true,
      label: 'Freight',
      formattedDate: 'Jan 2026',
    });

    expect(paymentReference).toBe('');
  });
});
