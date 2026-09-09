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

  const uniqueId1Targets = [
    {
      lineNumber: 1,
      invoiceNumber: '000036765/YD',
      settlementAmount: 2403.51,
      customerAccount: '101002253',
      transDate: '2026-01-05T00:00:00',
      currencyCode: 'EGP',
    },
    {
      lineNumber: 2,
      invoiceNumber: '000036765/YD',
      settlementAmount: 2403.5088,
      customerAccount: '101002253',
      transDate: '2026-01-01T00:00:00',
      currencyCode: 'EGP',
    },
    {
      lineNumber: 3,
      invoiceNumber: '000036765/YD',
      settlementAmount: 2067.0188,
      customerAccount: '101002253',
      transDate: '2026-01-05T00:00:00',
      currencyCode: 'EGP',
    },
  ];

  const mockGets = (
    d365: { get: jest.Mock },
    options?: {
      settlementExists?: boolean;
      recoverAfterPost?: boolean;
      custTrans?: Array<Record<string, unknown>>;
      existingSettlements?: Array<Record<string, unknown>>;
    },
  ) => {
    let settlementGets = 0;
    d365.get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('CustomerPaymentJournalLines')) {
        return {
          value: [{ LineNumber: 1 }, { LineNumber: 2 }, { LineNumber: 3 }],
        };
      }
      if (endpoint.includes('CustTransBiEntities')) {
        return {
          value: options?.custTrans ?? [
            {
              Invoice: '000036765/YD',
              AccountNum: '101002253',
              CurrencyCode: 'EGP',
              Closed: '1900-01-01T00:00:00Z',
              DueDate: '2026-01-31T12:00:00Z',
              AmountCur: 6500,
              SettleAmountCur: 0,
              SourceKey: 11,
            },
          ],
        };
      }
      settlementGets += 1;
      if (options?.existingSettlements && settlementGets === 1) {
        return { value: options.existingSettlements };
      }
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
          currencyCode: 'EGP',
        },
        {
          lineNumber: 2,
          invoiceNumber: '000036765/YD',
          settlementAmount: 2067.0188,
          customerAccount: '101002253',
          currencyCode: 'EGP',
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
        InvoiceToPaymentCrossRate: 1,
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
        InvoiceToPaymentCrossRate: 1,
      }),
      { retries: 0 },
    );
  });

  it('caps to the 2740 EGP remaining and skips exhausted UniqueId lines instead of failing', async () => {
    const { service, d365 } = buildService();
    mockGets(d365, {
      custTrans: [
        {
          Invoice: '000036765/YD',
          AccountNum: '101002253',
          CurrencyCode: 'EGP',
          Closed: '1900-01-01T00:00:00Z',
          DueDate: '2026-01-01T12:00:00Z',
          AmountCur: 2740,
          SettleAmountCur: 0,
          SourceKey: 101,
        },
      ],
    });

    const skips = await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: uniqueId1Targets,
    });

    // Line 1 fully covered; line 2 capped to the 336.49 leftover; line 3 skipped.
    expect(d365.post).toHaveBeenCalledTimes(2);
    expect(d365.post).toHaveBeenNthCalledWith(
      1,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 1,
        InvoiceDueDate: '2026-01-01T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2403.51,
      }),
      { retries: 0 },
    );
    expect(d365.post).toHaveBeenNthCalledWith(
      2,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 2,
        SettlementAmountInInvoiceCurrency: 336.49,
      }),
      { retries: 0 },
    );
    expect(skips).toEqual([
      expect.objectContaining({
        lineNumber: 2,
        invoiceNumber: '000036765/YD',
        requestedAmount: 2403.5088,
        settledAmount: 336.49,
      }),
      expect.objectContaining({
        lineNumber: 3,
        invoiceNumber: '000036765/YD',
        requestedAmount: 2067.0188,
        settledAmount: 0,
      }),
    ]);
  });

  it('skips settlement when the invoice has no open CustTrans at all', async () => {
    const { service, d365 } = buildService();
    mockGets(d365, { custTrans: [] });

    const skips = await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: [uniqueId1Targets[0]],
    });

    expect(d365.post).not.toHaveBeenCalled();
    expect(skips).toEqual([
      expect.objectContaining({
        lineNumber: 1,
        settledAmount: 0,
        reason: expect.stringContaining('No open customer transaction'),
      }),
    ]);
  });

  it('settles UniqueId split lines against separate open CustTrans rows', async () => {
    const { service, d365 } = buildService();
    mockGets(d365, {
      custTrans: [
        {
          Invoice: '000036765/YD',
          AccountNum: '101002253',
          CurrencyCode: 'EGP',
          Closed: '1900-01-01T00:00:00Z',
          DueDate: '2026-01-01T12:00:00Z',
          TransDate: '2026-01-01T00:00:00Z',
          AmountCur: 2740,
          SettleAmountCur: 0,
          SourceKey: 201,
        },
        {
          Invoice: '000036765/YD',
          AccountNum: '101002253',
          CurrencyCode: 'EGP',
          Closed: '1900-01-01T00:00:00Z',
          DueDate: '2026-01-05T12:00:00Z',
          TransDate: '2026-01-05T00:00:00Z',
          AmountCur: 2740,
          SettleAmountCur: 0,
          SourceKey: 202,
        },
        {
          Invoice: '000036765/YD',
          AccountNum: '101002253',
          CurrencyCode: 'EGP',
          Closed: '1900-01-01T00:00:00Z',
          DueDate: '2026-01-05T12:00:00Z',
          TransDate: '2026-01-05T00:00:00Z',
          AmountCur: 2356.4014,
          SettleAmountCur: 0,
          SourceKey: 203,
        },
      ],
    });

    await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: uniqueId1Targets,
    });

    expect(d365.post).toHaveBeenNthCalledWith(
      1,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 1,
        InvoiceDueDate: '2026-01-05T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2403.51,
      }),
      { retries: 0 },
    );
    expect(d365.post).toHaveBeenNthCalledWith(
      2,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 2,
        InvoiceDueDate: '2026-01-01T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2403.5088,
      }),
      { retries: 0 },
    );
    expect(d365.post).toHaveBeenNthCalledWith(
      3,
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 3,
        InvoiceDueDate: '2026-01-05T12:00:00Z',
        SettlementAmountInInvoiceCurrency: 2067.0188,
      }),
      { retries: 0 },
    );
  });

  it('counts an already-posted line 1 settlement against remaining and caps line 2', async () => {
    const { service, d365 } = buildService();
    mockGets(d365, {
      existingSettlements: [
        {
          JournalLineNumber: 1,
          InvoiceNumber: '000036765/YD',
          InvoiceDueDate: '2026-01-01T12:00:00Z',
          SettlementAmountInInvoiceCurrency: 2403.51,
        },
      ],
      custTrans: [
        {
          Invoice: '000036765/YD',
          AccountNum: '101002253',
          CurrencyCode: 'EGP',
          Closed: '1900-01-01T00:00:00Z',
          DueDate: '2026-01-01T12:00:00Z',
          AmountCur: 2740,
          SettleAmountCur: 0,
          SourceKey: 101,
        },
      ],
    });

    const skips = await service.createSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015850',
      targets: uniqueId1Targets,
    });

    // Line 1 already settled 2403.51 → line 2 capped to 336.49, line 3 skipped.
    expect(d365.post).toHaveBeenCalledTimes(1);
    expect(d365.post).toHaveBeenCalledWith(
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 2,
        SettlementAmountInInvoiceCurrency: 336.49,
      }),
      { retries: 0 },
    );
    expect(skips).toEqual([
      expect.objectContaining({ lineNumber: 2, settledAmount: 336.49 }),
      expect.objectContaining({ lineNumber: 3, settledAmount: 0 }),
    ]);
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
