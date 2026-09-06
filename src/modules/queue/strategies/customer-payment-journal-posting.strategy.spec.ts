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

    const strategy = new CustomerPaymentJournalPostingStrategy(
      customerPaymentJournalService as any,
      vendorPaymentJournalService as any,
    );

    return {
      strategy,
      customerPaymentJournalService,
      vendorPaymentJournalService,
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

  it('posts cash-in lines through the customer payment journal custom API', async () => {
    const { strategy, customerPaymentJournalService } = buildStrategy();

    strategy.setHeaderCashDirectionContext('in');
    await strategy.postLinesForHeader(
      'Mesco-000099999',
      [
        {
          LineNumber: 1,
          cashDirection: 'in',
          customLineApiBody: {
            creditAmount: 40,
            MarkedLines: [
              {
                InvoiceNumber: '000009214/Inv-SH',
                OperationNumber: '',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      20,
    );

    expect(
      customerPaymentJournalService.postCashInLinesForHeader,
    ).toHaveBeenCalledWith(
      'Mesco-000099999',
      expect.arrayContaining([
        expect.objectContaining({
          customLineApiBody: expect.objectContaining({
            MarkedLines: [
              {
                InvoiceNumber: '000009214/Inv-SH',
                OperationNumber: '',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          }),
        }),
      ]),
      20,
      'm-p',
    );
  });
});
