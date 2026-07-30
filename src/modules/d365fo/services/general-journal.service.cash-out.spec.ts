import { GeneralJournalService } from './general-journal.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

describe('GeneralJournalService cash-out custody matching', () => {
  it('matches all and only exact document/currency/amount/operation targets', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            JournalBatchNumber: 'JRN-1',
            LineNumber: 1,
            Document: 'DOC-100',
            CurrencyCode: 'EGP',
            DebitAmount: 0,
            CreditAmount: 1250,
            FinTagDisplayValue: 'OP-77|SECOND|THIRD',
          },
          {
            JournalBatchNumber: 'JRN-2',
            LineNumber: 2,
            Document: 'DOC-100',
            CurrencyCode: 'EGP',
            DebitAmount: -1250,
            CreditAmount: 0,
            FinTagDisplayValue: '\u200eOP-77|DIFFERENT',
          },
          {
            JournalBatchNumber: 'WRONG-CURRENCY',
            Document: 'DOC-100',
            CurrencyCode: 'USD',
            CreditAmount: 1250,
            FinTagDisplayValue: 'OP-77',
          },
          {
            JournalBatchNumber: 'WRONG-OPERATION',
            Document: 'DOC-100',
            CurrencyCode: 'EGP',
            CreditAmount: 1250,
            FinTagDisplayValue: 'OP-78',
          },
        ],
      }),
    };
    const service = new GeneralJournalService(
      d365foClient as any,
      new ODataQueryBuilderService(),
    );
    const target = {
      documentNumber: 'DOC-100',
      currency: 'egp',
      amount: 1250,
      operationNumber: ' OP-77 ',
    };

    const result = await service.findCustodySettlementTargets('mmsc', [target]);
    const matches = result.get(
      GeneralJournalService.custodySettlementTargetKey(target),
    );

    expect(matches).toHaveLength(2);
    expect(matches?.map((line) => line.JournalBatchNumber)).toEqual([
      'JRN-1',
      'JRN-2',
    ]);
    expect(d365foClient.get).toHaveBeenCalledTimes(1);
    expect(d365foClient.get.mock.calls[0][0]).toContain(
      '/data/LedgerJournalLines?',
    );
    expect(d365foClient.get.mock.calls[0][0]).toContain('DOC-100');
  });

  it('returns an empty entry when D365 has no exact match', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({ value: [] }),
    };
    const service = new GeneralJournalService(
      d365foClient as any,
      new ODataQueryBuilderService(),
    );
    const target = {
      documentNumber: 'DOC-MISSING',
      currency: 'EGP',
      amount: 500,
      operationNumber: 'OP-1',
    };

    const result = await service.findCustodySettlementTargets('mmsc', [target]);

    expect(
      result.get(GeneralJournalService.custodySettlementTargetKey(target)),
    ).toEqual([]);
  });
});
