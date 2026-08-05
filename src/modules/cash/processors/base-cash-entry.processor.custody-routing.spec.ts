import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { ProcessCashOutFreightCommand } from '@/modules/cash/commands/process-cash-out-freight.command';
import { ProcessCashOutTruckingCommand } from '@/modules/cash/commands/process-cash-out-trucking.command';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/cash-in-freight-entry.processor';
import { isCashInLedger421103Line } from '@/modules/cash/processors/cash-in-customer-fx.rules';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In Custody Settlement → Cash-Out routing', () => {
  const utilsService = new EntryProcessorUtilsService();

  const createProcessor = () => {
    const commandBus = { execute: jest.fn().mockResolvedValue({ id: 'co-1' }) };
    const processor = new CashInFreightEntryProcessor(commandBus as any, {
      queryBus: { execute: jest.fn() },
      exchangeRateService: {},
      utilsService,
      dimensionService: new DimensionValidationService(),
      taxGroupService: {},
      freeTextInvoiceService: {},
      vendorInvoiceJournalService: {},
      cashOutExchangeRateService: {
        load: jest.fn().mockResolvedValue(undefined),
      },
      generalJournalService: {},
    } as any);
    (processor as any).company = 'm-p';
    (processor as any).dimensionsMap = new Map();
    (processor as any).accountNumberSet = new Set();
    (processor as any).customerNameMap = new Map();
    (processor as any).exchangeRateMap = new Map();
    jest
      .spyOn(processor as any, 'warmupProcessorData')
      .mockResolvedValue(undefined);
    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 100,
      reportingRate: 100,
    });
    jest
      .spyOn(processor as any, 'fetchFreeTextInvoices')
      .mockResolvedValue(undefined);
    return { processor, commandBus };
  };

  const toModels = (lines: Array<Record<string, unknown>>) =>
    lines.map(
      (line) => new CashEntryRawDataModel(line as any, 'Freight', true),
    );

  it('routes Custody Settlement UniqueId to Cash-Out and excludes it from Cash-In output', async () => {
    const { processor, commandBus } = createProcessor();
    const raw = toModels([
      {
        UniqueId: 466700,
        LINENUMBER: 1,
        VOUCHER: 'CS-1',
        TRANSDATE: '2026-01-15',
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V-1',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466700,
        LINENUMBER: 2,
        VOUCHER: 'CS-1',
        TRANSDATE: '2026-01-15',
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B-1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466669,
        LINENUMBER: 3,
        VOUCHER: 'CI-1',
        TRANSDATE: '2026-01-15',
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C-1',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1301|013|001|001|C-1||||||||Payable|||IMPORT||||',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 50,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466669,
        LINENUMBER: 4,
        VOUCHER: 'CI-1',
        TRANSDATE: '2026-01-15',
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 50,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const enriched = await processor.formatAndEnrichAsync(raw as any, 'm-p');

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const command = commandBus.execute.mock.calls[0][0];
    expect(command).toBeInstanceOf(ProcessCashOutFreightCommand);
    expect(command.rawData).toHaveLength(2);
    expect(command.rawData.every((line: any) => line.UniqueId === 466700)).toBe(
      true,
    );

    // Cash-In output must not include the custody UniqueId.
    expect(
      enriched.every((line: any) => !line.SourceIds?.includes('466700')),
    ).toBe(true);
    expect(enriched.some((line: any) => line.SourceIds?.includes('466669'))).toBe(
      true,
    );
  });

  it('routes Fleet TargetProcessor custody groups to Cash-Out Trucking', async () => {
    const { processor, commandBus } = createProcessor();
    const raw = toModels([
      {
        UniqueId: 10,
        LINENUMBER: 1,
        SafeType: ' custody settlement ',
        TargetProcessor: 'Fleet',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V-1',
        DEBITAMOUNT: 20,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 10,
        LINENUMBER: 2,
        SafeType: 'CUSTODY SETTLEMENT',
        TargetProcessor: 'Fleet',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B-1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 20,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
    ]);

    await processor.formatAndEnrichAsync(raw as any, 'm-p');

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(commandBus.execute.mock.calls[0][0]).toBeInstanceOf(
      ProcessCashOutTruckingCommand,
    );
  });

  it('does not apply Cash-In FX / 421103 transforms to Custody Settlement groups', async () => {
    const { processor, commandBus } = createProcessor();
    const fxSpy = jest.spyOn(
      processor as any,
      'applyCashInCustomerForeignCurrencyRules',
    );

    const raw = toModels([
      {
        UniqueId: 20,
        LINENUMBER: 1,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 730,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 20,
        LINENUMBER: 2,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 737,
        CURRENCYCODE: 'USD',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 20,
        LINENUMBER: 3,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|1301|013',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 26,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
    ]);

    await processor.formatAndEnrichAsync(raw as any, 'm-p');

    // Custody lines are removed before FX; FX still runs on remaining Cash-In
    // lines (none here), and must never receive the custody UniqueId.
    expect(fxSpy).toHaveBeenCalled();
    const fxInput = fxSpy.mock.calls[0][0] as CashEntryRawDataModel[];
    expect(fxInput).toHaveLength(0);

    const routed = commandBus.execute.mock.calls[0][0].rawData;
    expect(routed).toHaveLength(3);
    expect(routed.some((line: any) => isCashInLedger421103Line(line))).toBe(
      true,
    );
    expect(
      routed.find((line: any) => line.LINENUMBER === 2).CREDITAMOUNT,
    ).toBe(737);
  });

  it('emits a Cash-In validation failure for conflicting SafeTypes and routes neither processor', async () => {
    const { processor, commandBus } = createProcessor();
    const raw = toModels([
      {
        UniqueId: 30,
        LINENUMBER: 1,
        VOUCHER: 'X-1',
        SafeType: 'Custody Settlement',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 30,
        LINENUMBER: 2,
        VOUCHER: 'X-1',
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Cust',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 10,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        VoucherType: 'Cash',
      },
    ]);

    const enriched = await processor.formatAndEnrichAsync(raw as any, 'm-p');

    expect(commandBus.execute).not.toHaveBeenCalled();
    expect(enriched).toHaveLength(1);
    expect(enriched[0].ErrorCount).toBeGreaterThan(0);
    expect(
      enriched[0]
        .GetErrors()
        .some((error: string) => error.includes('Conflicting Safe Type')),
    ).toBe(true);
  });

  it('preserves original source fields when handing lines to Cash-Out', async () => {
    const { processor, commandBus } = createProcessor();
    const raw = toModels([
      {
        UniqueId: 40,
        LINENUMBER: 7,
        VOUCHER: 'CS-40',
        TRANSDATE: '2026-03-01',
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V-40',
        OFFSETACCOUNTTYPE: 'Bank',
        OFFSETACCOUNTDISPLAYVALUE: 'B-40',
        DEBITAMOUNT: 15,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4800,
        INVOICE: 'INV-40, INV-41',
        DOCUMENT: 'DOC-40',
        VoucherType: 'Transfer',
      },
    ]);

    await processor.formatAndEnrichAsync(raw as any, 'm-p');

    const handedOff = commandBus.execute.mock.calls[0][0].rawData[0];
    expect(handedOff.UniqueId).toBe(40);
    expect(handedOff.LINENUMBER).toBe(7);
    expect(handedOff.VOUCHER).toBe('CS-40');
    expect(handedOff.DEBITAMOUNT).toBe(15);
    expect(handedOff.CURRENCYCODE).toBe('USD');
    expect(handedOff.INVOICE).toBe('INV-40, INV-41');
    expect(handedOff.DOCUMENT).toBe('DOC-40');
    expect(handedOff.TargetProcessor).toBe('Freight');
    expect(handedOff.SafeType).toBe('Custody Settlement');
  });
});
