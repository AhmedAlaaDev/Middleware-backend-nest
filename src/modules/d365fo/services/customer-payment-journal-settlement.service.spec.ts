import { CustomerPaymentJournalSettlementService } from '@/modules/d365fo/services/customer-payment-journal-settlement.service';

describe('CustomerPaymentJournalSettlementService', () => {
  const buildService = () => {
    const d365 = {
      get: jest.fn().mockResolvedValue({ value: [] }),
      post: jest.fn().mockResolvedValue({}),
    };
    const query = {
      buildQuery: jest
        .fn()
        .mockReturnValue('/data/PaymentJournalLineSettledInvoices?$top=1'),
      and: jest.fn((...parts: string[]) => parts.join(' and ')),
      eq: jest.fn(
        (field: string, value: string | number) => `${field} eq ${value}`,
      ),
    };
    const service = new CustomerPaymentJournalSettlementService(
      d365 as any,
      query as any,
    );
    return { service, d365 };
  };

  it('posts each journal line amount against the same invoice', async () => {
    const { service, d365 } = buildService();

    await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: [
        {
          lineNumber: 1,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2403.51,
        },
        {
          lineNumber: 2,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2067.0188,
        },
      ],
    });

    expect(d365.post).toHaveBeenNthCalledWith(
      1,
      '/data/PaymentJournalLineSettledInvoices',
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015850',
        JournalLineNumber: 1,
        InvoiceNumber: '000036765/YD',
        InvoiceCompany: 'm-p',
        SettlementAmountInInvoiceCurrency: 2403.51,
      },
      { retries: 0 },
    );
    expect(d365.post).toHaveBeenNthCalledWith(
      2,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 2,
        InvoiceNumber: '000036765/YD',
        SettlementAmountInInvoiceCurrency: 2067.0188,
      }),
      { retries: 0 },
    );
  });
});
