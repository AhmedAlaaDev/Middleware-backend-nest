import { CustomerPaymentJournalPostingStrategy } from './customer-payment-journal-posting.strategy';

describe('CustomerPaymentJournalPostingStrategy - cash direction routing', () => {
  const buildStrategy = () => {
    const customerPaymentJournalService = {
      deleteHeader: jest.fn().mockResolvedValue(undefined),
      deleteLine: jest.fn().mockResolvedValue(undefined),
      listLinesForHeader: jest.fn().mockResolvedValue([]),
      postCashInLinesForHeader: jest
        .fn()
        .mockResolvedValue([{ headerId: 'AR-0001', lineNumber: 1 }]),
      postCashOutLinesForHeader: jest
        .fn()
        .mockResolvedValue([{ headerId: 'OUT-0001', lineNumber: 1 }]),
    };
    const vendorPaymentJournalService = {
      deleteHeader: jest.fn().mockResolvedValue(undefined),
      deleteLine: jest.fn().mockResolvedValue(undefined),
      listLinesForHeader: jest.fn().mockResolvedValue([{ LineNumber: 1 }]),
    };
    const customerPaymentJournalSettlementService = {
      createSettlements: jest.fn().mockResolvedValue(undefined),
    };

    const strategy = new CustomerPaymentJournalPostingStrategy(
      customerPaymentJournalService as any,
      vendorPaymentJournalService as any,
      customerPaymentJournalSettlementService as any,
    );

    return {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
      customerPaymentJournalSettlementService,
    };
  };

  it('deletes cash-out headers via VendorPaymentJournalHeaders', async () => {
    const {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
    } = buildStrategy();

    strategy.setHeaderCashDirectionContext('out');
    await strategy.deleteHeader('Mesco-000013557', 'm-p');

    expect(vendorPaymentJournalService.deleteHeader).toHaveBeenCalledWith(
      'Mesco-000013557',
      'm-p',
    );
    expect(customerPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('deletes cash-in headers via CustomerPaymentJournalHeaders', async () => {
    const {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
    } = buildStrategy();

    strategy.setHeaderCashDirectionContext('in');
    await strategy.deleteHeader('Mesco-000000001', 'm-p');

    expect(customerPaymentJournalService.deleteHeader).toHaveBeenCalledWith(
      'Mesco-000000001',
      'm-p',
    );
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('lists cash-out lines via VendorPaymentJournalLines', async () => {
    const {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
    } = buildStrategy();

    strategy.setHeaderCashDirectionContext('out');
    const lines = await strategy.listLinesForHeader('Mesco-000013557', 'm-p');

    expect(lines).toEqual([{ LineNumber: 1 }]);
    expect(vendorPaymentJournalService.listLinesForHeader).toHaveBeenCalledWith(
      'Mesco-000013557',
      'm-p',
    );
    expect(
      customerPaymentJournalService.listLinesForHeader,
    ).not.toHaveBeenCalled();
  });

  it('deletes cash-out lines via VendorPaymentJournalLines', async () => {
    const {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
    } = buildStrategy();

    strategy.setHeaderCashDirectionContext('out');
    const result = await strategy.deleteLinesInBatches(
      [{ headerId: 'Mesco-000013557', lineNumber: 1 }],
      'm-p',
      20,
    );

    expect(result.successful).toEqual([
      { headerId: 'Mesco-000013557', lineNumber: 1 },
    ]);
    expect(vendorPaymentJournalService.deleteLine).toHaveBeenCalledWith(
      'Mesco-000013557',
      1,
      'm-p',
    );
    expect(customerPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('settles cash-in lines through PaymentJournalLineSettledInvoices after posting', async () => {
    const {
      strategy,
      customerPaymentJournalService,
      customerPaymentJournalSettlementService,
    } = buildStrategy();

    strategy.setHeaderCashDirectionContext('in');
    await strategy.postLinesForHeader(
      'Mesco-000015850',
      [
        {
          LineNumber: 1,
          cashDirection: 'in',
          customerSettlement: {
            invoiceNumber: '000036765/YD',
            settlementAmount: 2403.51,
          },
          customLineApiBody: { creditAmount: 2403.51, MarkedLines: [] },
        },
        {
          LineNumber: 2,
          cashDirection: 'in',
          customerSettlement: {
            invoiceNumber: '000036765/YD',
            settlementAmount: 2067.0188,
          },
          customLineApiBody: { creditAmount: 2067.0188, MarkedLines: [] },
        },
      ],
      'm-p',
      20,
    );

    expect(
      customerPaymentJournalService.postCashInLinesForHeader,
    ).toHaveBeenCalled();
    expect(
      customerPaymentJournalSettlementService.createSettlements,
    ).toHaveBeenCalledWith({
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
  });

  it('does not settle cash-in freight lines that have no customerSettlement', async () => {
    const { strategy, customerPaymentJournalSettlementService } =
      buildStrategy();

    strategy.setHeaderCashDirectionContext('in');
    await strategy.postLinesForHeader(
      'Mesco-000000001',
      [
        {
          LineNumber: 1,
          cashDirection: 'in',
          customLineApiBody: { creditAmount: 100 },
        },
      ],
      'm-p',
      20,
    );

    expect(
      customerPaymentJournalSettlementService.createSettlements,
    ).not.toHaveBeenCalled();
  });
});
