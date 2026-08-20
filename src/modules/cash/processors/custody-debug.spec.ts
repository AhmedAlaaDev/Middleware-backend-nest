import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

const DIM19 = '|1301|013|001|001|||||||||||||||||';

function makeRow(overrides: Record<string, any>): any {
  return {
    UniqueId: 2,
    LINENUMBER: 1,
    VOUCHER: 'V-002',
    TRANSDATE: '2024-01-15',
    ACCOUNTTYPE: 'Ledger',
    ACCOUNTDISPLAYVALUE: '',
    DEFAULTDIMENSIONDISPLAYVALUE: DIM19,
    FINTAGDISPLAYVALUE: '',
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    CURRENCYCODE: 'EGP',
    EXCHANGERATE: 1,
    OFFSETACCOUNTTYPE: '',
    OFFSETACCOUNTDISPLAYVALUE: '',
    OFFSETDEFAULTDIMENSIONDISPLAYVALUE: '',
    OFFSETFINTAGDISPLAYVALUE: '',
    DOCUMENT: '',
    INVOICE: '',
    MARKEDINVOICE: '',
    SafeType: 'Custody Settlement',
    VoucherType: 'Cash',
    ...overrides,
  };
}

function buildProcessor(vendorGroupMap: Record<string, string>) {
  const vendorAccounts = Object.keys(vendorGroupMap);
  const processor = new CashOutFreightEntryProcessor(
    { execute: jest.fn() } as any,
    {
      queryBus: {
        execute: jest.fn().mockResolvedValue({
          items: vendorAccounts.map((account) => ({
            vendorAccountNumber: account,
            vendorGroupId: vendorGroupMap[account],
          })),
        }),
      },
      exchangeRateService: {},
      utilsService: new EntryProcessorUtilsService(),
      dimensionService: new DimensionValidationService(),
      taxGroupService: {},
      freeTextInvoiceService: {},
      vendorInvoiceJournalService: {},
      cashOutExchangeRateService: {
        load: jest.fn().mockResolvedValue(undefined),
      },
      generalJournalService: {},
    } as any,
  );

  jest
    .spyOn(processor as any, 'warmupProcessorData')
    .mockResolvedValue(undefined);
  jest
    .spyOn(processor as any, 'collectSourceDimensionErrors')
    .mockImplementation(() => undefined);
  jest
    .spyOn(processor as any, 'fetchVendorInvoiceExistsMap')
    .mockResolvedValue(undefined);
  jest
    .spyOn(processor as any, 'fetchExchangeRates')
    .mockReturnValue({ exchangeRate: 1, reportingRate: 1 });
  (processor as any).vendorNameMap = new Map();
  return processor;
}

describe('Debug trade vendor + 223304', () => {
  it('dumps the output', async () => {
    const rows = [
      makeRow({
        UniqueId: 2,
        LINENUMBER: 1,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'TRADE-001',
        DEFAULTDIMENSIONDISPLAYVALUE: DIM19,
        FINTAGDISPLAYVALUE: '22001|OP|line',
        INVOICE: '000000001/INV',
        DEBITAMOUNT: 5000,
        CREDITAMOUNT: 0,
      }),
      makeRow({
        UniqueId: 2,
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 4500,
      }),
      makeRow({
        UniqueId: 2,
        LINENUMBER: 3,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: `223304${DIM19}`,
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 500,
      }),
    ];

    const processor = buildProcessor({ 'TRADE-001': 'Trade' });
    const result = (await processor.formatAndEnrichAsync(rows, 'm-p')) as any[];

    console.log('Result count:', result.length);
    for (const line of result) {
      console.log(
        JSON.stringify(
          {
            AccountType: line.AccountType,
            AccountDisplayValue: line.AccountDisplayValue,
            OffsetAccountType: line.OffsetAccountType,
            OffsetAccountDisplayValue: line.OffsetAccountDisplayValue,
            DebitAmount: line.DebitAmount,
            CreditAmount: line.CreditAmount,
            MarkedLines: line.MarkedLines,
            Description: line.Description,
            SafeType: line.SafeType,
            VendorGroup: line.VendorGroup,
          },
          null,
          2,
        ),
      );
    }

    expect(result.length).toBeGreaterThan(0);
  });
});
