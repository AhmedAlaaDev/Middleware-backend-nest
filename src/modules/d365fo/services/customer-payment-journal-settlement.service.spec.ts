import { CustomerPaymentJournalSettlementService } from '@/modules/d365fo/services/customer-payment-journal-settlement.service';

describe('CustomerPaymentJournalSettlementService', () => {
  const buildService = () => {
    const d365 = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({}),
    };
    const query = {
      buildQuery: jest.fn(
        (endpoint: string) => `${endpoint}?cross-company=true`,
      ),
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

  const mockGets = (
    d365: { get: jest.Mock },
    options?: { settlementExists?: boolean; recoverAfterPost?: boolean },
  ) => {
    let settlementGets = 0;
    d365.get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('CustomerPaymentJournalLines')) {
        return { value: [{ LineNumber: 1 }, { LineNumber: 2 }] };
      }
      if (endpoint.includes('CustTransBiEntities')) {
        return {
          value: [
            {
              Invoice: '000036765/YD',
              AccountNum: '101002253',
              Closed: '1900-01-01T00:00:00Z',
              DueDate: '2026-01-31T12:00:00Z',
              AmountCur: 6500,
              SettleAmountCur: 0,
            },
          ],
        };
      }
      settlementGets += 1;
      if (options?.settlementExists) {
        return {
          value: [
            {
              JournalLineNumber: 1,
              InvoiceNumber: '000036765/YD',
            },
          ],
        };
      }
      if (options?.recoverAfterPost && settlementGets >= 2) {
        return {
          value: [
            {
              JournalLineNumber: 1,
              InvoiceNumber: '000036765/YD',
            },
          ],
        };
      }
      return { value: [] };
    });
  };

  it('posts each journal line amount against the same invoice with InvoiceDueDate', async () => {
    const { service, d365 } = buildService();
    mockGets(d365);

    await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: [
        {
          lineNumber: 1,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2403.51,
          customerAccount: '101002253',
        },
        {
          lineNumber: 2,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2067.0188,
          customerAccount: '101002253',
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
        InvoiceDueDate: '2026-01-31T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2403.51,
        CashDiscountToTakeInInvoiceCurrency: 0,
      },
      { retries: 0 },
    );
    expect(d365.post).toHaveBeenNthCalledWith(
      2,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 2,
        InvoiceNumber: '000036765/YD',
        InvoiceDueDate: '2026-01-31T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2067.0188,
      }),
      { retries: 0 },
    );
  });

  it('recovers RecId 0 when the settlement row exists after the write error', async () => {
    const { service, d365 } = buildService();
    mockGets(d365, { recoverAfterPost: true });
    d365.post.mockRejectedValueOnce(
      new Error(
        "Write returned RecId 0 for table row of type 'CustomerPaymentJournalLineSettledInvoiceEntity'. Infolog: .",
      ),
    );

    await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: [
        {
          lineNumber: 1,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2403.51,
          customerAccount: '101002253',
        },
      ],
    });

    expect(d365.post).toHaveBeenCalledTimes(1);
  });

  it('fails when the journal line is not in CustomerPaymentJournalLines', async () => {
    const { service, d365 } = buildService();
    d365.get.mockResolvedValue({ value: [] });

    await expect(
      service.createSettlements({
        company: 'm-p',
        journalBatchNumber: 'Mesco-000015850',
        targets: [
          {
            lineNumber: 1,
            invoiceNumber: '000036765/YD',
            settlementAmount: 2403.51,
            customerAccount: '101002253',
          },
        ],
      }),
    ).rejects.toThrow('CustomerPaymentJournalLines has no line 1');
    expect(d365.post).not.toHaveBeenCalled();
  });
});
