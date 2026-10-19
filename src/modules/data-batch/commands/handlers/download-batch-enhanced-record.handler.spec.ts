import { DownloadBatchEnhancedRecordHandler } from '@/modules/data-batch/commands/handlers/download-batch-enhanced-record.handler';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

describe('DownloadBatchEnhancedRecordHandler Finance identifiers', () => {
  const createHandler = (financeLines: unknown[] = []) => {
    const d365 = {
      get: jest.fn().mockResolvedValue({ value: financeLines }),
    };
    const query = {
      buildQuery: jest
        .fn()
        .mockReturnValue('/data/CustomerPaymentJournalLines'),
      and: jest.fn().mockReturnValue('filter'),
      eq: jest.fn().mockReturnValue('expression'),
    };
    const handler = new DownloadBatchEnhancedRecordHandler(
      {} as never,
      {} as never,
      d365 as never,
      query as never,
    );
    return { handler, d365 };
  };

  it.each([
    ['Cash-In Freight', EntryProcessorTypes.CashInFreight],
    ['Cash-In Fleet', EntryProcessorTypes.CashInTrucking],
  ])(
    'uses Finance batch and voucher values for %s exports',
    async (_label, entryProcessorType) => {
      const { handler } = createHandler([
        {
          JournalBatchNumber: 'Mesco-000016704',
          LineNumber: 1,
          Voucher: 'CPay-000114460',
        },
      ]);

      const identifiers = await (handler as any).loadCashInFinanceIdentifiers(
        entryProcessorType,
        'm-p',
        ['Mesco-000016704'],
        ['Mesco-000000001'],
        [
          {
            plannedJournalBatchNumber: 'Mesco-000000001',
            financeJournalBatchNumber: 'Mesco-000016704',
          },
        ],
      );

      const enhanced = (handler as any).withFinanceIdentifiers(
        {
          LineNumber: 1,
          JournalBatchNumber: 'Mesco-000000001',
          Voucher: 'Cust-Pay-000000001',
        },
        identifiers,
      );

      expect(enhanced).toMatchObject({
        PlannedJournalBatchNumber: 'Mesco-000000001',
        PlannedVoucher: 'Cust-Pay-000000001',
        FinanceJournalBatchNumber: 'Mesco-000016704',
        FinanceVoucher: 'CPay-000114460',
        JournalBatchNumber: 'Mesco-000016704',
        Voucher: 'CPay-000114460',
        FinanceIdentifierStatus: 'Finance batch and voucher synchronized',
      });
    },
  );

  it('leaves non-cash-in exports unchanged', async () => {
    const { handler, d365 } = createHandler();

    const result = await (handler as any).loadCashInFinanceIdentifiers(
      EntryProcessorTypes.AccountReceivableFreight,
      'm-p',
      ['Mesco-000016704'],
      ['Mesco-000000001'],
      [],
    );

    expect(result).toBeUndefined();
    expect(d365.get).not.toHaveBeenCalled();
  });
});
