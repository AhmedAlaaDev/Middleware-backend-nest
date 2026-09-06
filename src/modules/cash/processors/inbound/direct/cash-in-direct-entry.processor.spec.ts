import { CashInShiplinkEntryProcessor } from '@/modules/cash/processors/inbound/shiplink/cash-in-shiplink-entry.processor';
import { CashInYardEntryProcessor } from '@/modules/cash/processors/inbound/yard/cash-in-yard-entry.processor';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';

describe('Cash-In Shiplink and Yard processors', () => {
  const dimension =
    '|3101|031|003|001|101009047|101009047|||02009|General|General|Prepaid|||Export||||';

  const createProcessor = (Processor: typeof CashInShiplinkEntryProcessor) => {
    const processor = new Processor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {
          fetchExchangeRates: () => ({ exchangeRate: 4750, reportingRate: 4750 }),
        },
        utilsService: {
          parseDimensionString: () => ({}),
          getDimensionSegmentLength: () => 19,
          isValidDimensionSegmentLength: () => true,
          updateCashBatchAndVoucher: ({ lines }: { lines: unknown[] }) => lines,
        },
        dimensionService: {},
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
      } as any,
    );

    jest
      .spyOn(processor as any, 'warmupProcessorData')
      .mockResolvedValue(undefined);
    jest.spyOn(processor as any, 'getCustomerName').mockReturnValue('Customer');
    jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockReturnValue({ exchangeRate: 4750, reportingRate: 4750 });

    return processor;
  };

  const sourceRows = [
    {
      UniqueId: 1,
      JOURNALNAME: 'BankIn',
      DESCRIPTION: 'BankIn - CIB-US-CA',
      VOUCHER: '1-Deposit',
      TRANSDATE: '2026-01-08',
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101009047',
      DEFAULTDIMENSIONDISPLAYVALUE: dimension,
      FINTAGDISPLAYVALUE: 'TAG',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 40,
      CURRENCYCODE: 'USD',
      EXCHANGERATE: 0,
      OFFSETACCOUNTTYPE: 'Bank',
      OFFSETACCOUNTDISPLAYVALUE: 'CIB-US-CA',
      OFFSETDEFAULTDIMENSIONDISPLAYVALUE: dimension,
      INVOICE: '000009214/Inv-SH',
      PAYMENTREFERENCE: 'FT25363HWKSP',
      SafeType: 'DownPayment',
      VoucherType: 'Deposit',
    },
    {
      UniqueId: 1,
      JOURNALNAME: 'BankIn',
      DESCRIPTION: 'BankIn - CIB-US-CA',
      VOUCHER: '1-Deposit',
      TRANSDATE: '2026-01-08',
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101009047',
      DEFAULTDIMENSIONDISPLAYVALUE: dimension,
      FINTAGDISPLAYVALUE: 'TAG',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 116,
      CURRENCYCODE: 'EGP',
      EXCHANGERATE: 100,
      OFFSETACCOUNTTYPE: 'Ledger',
      OFFSETACCOUNTDISPLAYVALUE: `524529${dimension}`,
      INVOICE: '000009214/Inv-SH',
      SafeType: 'DownPayment',
      VoucherType: 'Deposit',
    },
  ];

  it.each([
    [CashInShiplinkEntryProcessor, EntryProcessorTypes.CashInShiplink],
    [CashInYardEntryProcessor, EntryProcessorTypes.CashInYard],
  ] as const)(
    'maps every source row 1:1 without Freight pairing rules for %s',
    async (Processor, entryProcessorType) => {
      const processor = createProcessor(Processor as any);
      expect(processor.entryProcessorType).toBe(entryProcessorType);

      const lines = (await processor.formatAndEnrichAsync(
        sourceRows as any,
        'm-p',
      )) as CashEntryDynDataModel[];

      expect(lines).toHaveLength(2);
      expect(lines[0].OffsetAccountDisplayValue).toBe('CIB-US-CA');
      expect(lines[1].OffsetAccountDisplayValue).toBe('524529');
      expect(lines[0].Invoice).toBe('000009214/Inv-SH');
      expect(lines[0].SettlementIntent).toBe('Unmarked');
      expect(lines[0].MarkedLines).toEqual([]);
      expect(lines[0].CreditAmount).toBe(40);
      expect(lines[1].CurrencyCode).toBe('EGP');
      expect(lines[1].ExchangeRate).toBe(100);
    },
  );
});
