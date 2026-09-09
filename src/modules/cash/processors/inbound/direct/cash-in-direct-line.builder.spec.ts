import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInDirectLineBuilder } from '@/modules/cash/processors/inbound/direct/cash-in-direct-line.builder';
import { formatCashInboundInvoice } from '@/modules/cash/policies/cash-invoice.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

describe('CashInDirectLineBuilder', () => {
  const dimension =
    '|3101|031|003|001|101009047|101009047|||02009|General|General|Prepaid|||Export||||';

  const createBuilder = (
    overrides?: Partial<ConstructorParameters<typeof CashInDirectLineBuilder>[0]>,
  ) =>
    new CashInDirectLineBuilder({
      company: 'm-p',
      parseDimensionString: () => new EntryDimensionsModel(),
      getDimensionSegmentLength: () => 19,
      isValidDimensionSegmentLength: () => true,
      fetchExchangeRates: () => ({ exchangeRate: 4750, reportingRate: 4750 }),
      getCustomerName: () => 'Test Customer',
      ...overrides,
    });

  const sourceRow = (overrides: Record<string, unknown> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 1,
        JOURNALNAME: 'BankIn',
        DESCRIPTION: 'BankIn - CIB-US-CA',
        VOUCHER: '1-Deposit',
        TRANSDATE: '2026-01-08',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101009047',
        DEFAULTDIMENSIONDISPLAYVALUE: dimension,
        FINTAGDISPLAYVALUE: 'ISOKA2025008582||RCL||SOKCW25000775',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 40,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 0,
        OFFSETACCOUNTTYPE: 'Bank',
        OFFSETACCOUNTDISPLAYVALUE: 'CIB-US-CA',
        OFFSETDEFAULTDIMENSIONDISPLAYVALUE: dimension,
        PAYMENTMETHOD: 'Deposit',
        INVOICE: '000009214/Inv-SH',
        PAYMENTREFERENCE: 'FT25363HWKSP',
        SafeType: 'DownPayment',
        VoucherType: 'Deposit',
        ...overrides,
      } as any,
      'Shiplink',
      true,
    );

  it('maps one Excel row into a customer payment line without pairing', () => {
    const line = createBuilder().build(sourceRow());

    expect(line.AccountType).toBe('Cust');
    expect(line.AccountDisplayValue).toBe('101009047');
    expect(line.OffsetAccountType).toBe('Bank');
    expect(line.OffsetAccountDisplayValue).toBe('CIB-US-CA');
    expect(line.CreditAmount).toBe(40);
    expect(line.DebitAmount).toBe(0);
    expect(line.JournalName).toBe('Cust-Pay');
    expect(line.Description).toBe('BankIn - CIB-US-CA');
    expect(line.PaymentReference).toBe('FT25363HWKSP');
    expect(line.SettlementIntent).toBe('Unmarked');
    expect(line.MarkedLines).toEqual([]);
    expect(line.Invoice).toBe('000009214/Inv-SH');
    expect(line.PaymentId).toBe('1');
    expect(line.Company).toBe('m-p');
  });

  it('keeps the source invoice identity instead of Freight suffix rules', () => {
    const invoice = '000009214/Inv-SH';
    const line = createBuilder().build(sourceRow({ INVOICE: invoice }));

    expect(line.Invoice).toBe(invoice);
    expect(line.MarkedInvoice).toBe(invoice);
    expect(formatCashInboundInvoice(invoice)).toBe('000009214/INV-SH');
    expect(line.Invoice).not.toBe(formatCashInboundInvoice(invoice));
  });

  it('keeps DOCUMENT on the journal line; settlement amount is applied later', () => {
    const line = createBuilder().build(
      sourceRow({ DOCUMENT: 'ISOKA2025008582' }),
    );

    expect(line.Document).toBe('ISOKA2025008582');
    expect(line.Invoice).toBe('000009214/Inv-SH');
    expect(line.CreditAmount).toBe(40);
    expect(line.MarkedLines).toEqual([]);
  });

  it('takes the ledger main account from a composite offset display value', () => {
    const line = createBuilder().build(
      sourceRow({
        OFFSETACCOUNTTYPE: 'Ledger',
        OFFSETACCOUNTDISPLAYVALUE:
          '524529|3101|031|003|001|101009047|101009047|||02009|General|General|Prepaid|||Export||||',
      }),
    );

    expect(line.OffsetAccountType).toBe('Ledger');
    expect(line.OffsetAccountDisplayValue).toBe('524529');
  });

  it('uses EGP exchange rate 100 from the cash-in posting format', () => {
    const line = createBuilder().build(
      sourceRow({
        CURRENCYCODE: 'EGP       ',
        EXCHANGERATE: 0,
        CREDITAMOUNT: 116,
      }),
    );

    expect(line.CurrencyCode).toBe('EGP');
    expect(line.ExchangeRate).toBe(100);
    expect(line.ExchRate).toBe(100);
  });

  it('flags a missing invoice because settlement requires it', () => {
    const line = createBuilder().build(sourceRow({ INVOICE: '' }));

    expect(line.GetErrors().some((error) => error.startsWith('Invoice:'))).toBe(
      true,
    );
  });

  it('copies OFFSETACCOUNTDISPLAYVALUE from the same Excel row', () => {
    const row = sourceRow();
    expect(row.OFFSETACCOUNTDISPLAYVALUE).toBe('CIB-US-CA');
    expect(row.OFFSETACCOUNTTYPE).toBe('Bank');
  });

  it('maps a debit-column Excel amount and does not require credit', () => {
    const line = createBuilder().build(
      sourceRow({
        DEBITAMOUNT: 25,
        CREDITAMOUNT: 0,
      }),
    );

    expect(line.DebitAmount).toBe(25);
    expect(line.CreditAmount).toBe(0);
    expect(
      line.GetErrors().some((error) => error.startsWith('CreditAmount:')),
    ).toBe(false);
  });
});
