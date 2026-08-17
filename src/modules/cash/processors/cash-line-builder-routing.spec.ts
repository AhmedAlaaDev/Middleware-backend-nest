import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/inbound/freight/cash-in-freight-entry.processor';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';

function createProcessor(Processor: any): any {
  const processor = new Processor(
    { execute: jest.fn() },
    {
      queryBus: { execute: jest.fn() },
      exchangeRateService: {},
      utilsService: { parseDimensionString: jest.fn(() => ({})) },
      dimensionService: {},
      taxGroupService: {},
      freeTextInvoiceService: {},
      vendorInvoiceJournalService: {},
    },
  );
  processor.company = 'm-p';
  return processor;
}

describe('Cash line-builder direction boundary', () => {
  const sourceLine = new CashEntryRawDataModel(
    {
      UniqueId: 1,
      LINENUMBER: 1,
      VOUCHER: 'V1',
      DEBITAMOUNT: 10,
      CREDITAMOUNT: 0,
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: 'CUST-1',
      SafeType: 'Customer Collection',
      VoucherType: 'Cash',
    } as any,
    'Freight',
    true,
  );

  it('routes Cash-In through buildLineInbound', () => {
    const processor = createProcessor(CashInFreightEntryProcessor);
    const inbound = jest
      .spyOn(processor, 'buildLineInbound')
      .mockReturnValue([]);
    const outbound = jest
      .spyOn(processor, 'buildLineOutbound')
      .mockReturnValue([]);

    processor.buildLines('V1', [sourceLine]);

    expect(inbound).toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it('routes Cash-Out through buildLineOutbound', () => {
    const processor = createProcessor(CashOutFreightEntryProcessor);
    const inbound = jest
      .spyOn(processor, 'buildLineInbound')
      .mockReturnValue([]);
    const outbound = jest
      .spyOn(processor, 'buildSourceLineOutbound')
      .mockReturnValue([]);

    processor.buildLines('V1', [sourceLine]);

    expect(outbound).toHaveBeenCalled();
    expect(inbound).not.toHaveBeenCalled();
  });
});
