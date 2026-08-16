import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/cash-in-freight-entry.processor';
import { CashOutExchangeRateService } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In UniqueId + money-type balance validation', () => {
  const utilsService = new EntryProcessorUtilsService();
  const dimensionService = new DimensionValidationService();

  const createProcessor = () => {
    const cashOutExchangeRateService = {
      load: jest.fn().mockResolvedValue(null),
      resolveReporting: jest.fn(),
    } as unknown as CashOutExchangeRateService;
    const processor = new CashInFreightEntryProcessor(
      { execute: jest.fn() } as never,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService,
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService,
      } as never,
    );
    (processor as any).company = 'm-p';
    return processor;
  };

  const line = (
    uniqueId: number,
    opts: {
      lineNumber: number;
      debit?: number;
      credit?: number;
      voucherType: string;
      currency?: string;
    },
  ) =>
    new CashEntryRawDataModel(
      {
        UniqueId: uniqueId,
        LINENUMBER: opts.lineNumber,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: opts.debit ? 'Bank' : 'Cust',
        ACCOUNTDISPLAYVALUE: opts.debit ? 'BANK-1' : 'CUST-1',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1402|014|001|005||||6011||5036|5036|Payable|||EXPORT||||',
        DEBITAMOUNT: opts.debit ?? 0,
        CREDITAMOUNT: opts.credit ?? 0,
        CURRENCYCODE: opts.currency ?? 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: opts.voucherType,
      } as never,
      'Freight',
      true,
    );

  it('balances each UniqueId money type separately (Cash vs Transfer)', () => {
    const processor = createProcessor();
    const invoiceMap = new Map([
      [
        '9001',
        [
          line(9001, { lineNumber: 1, debit: 100, voucherType: 'Cash' }),
          line(9001, { lineNumber: 2, credit: 100, voucherType: 'Cash' }),
          line(9001, { lineNumber: 3, debit: 50, voucherType: 'Transfer' }),
          // Transfer intentionally unbalanced
          line(9001, { lineNumber: 4, credit: 40, voucherType: 'Transfer' }),
        ],
      ],
    ]);

    const unbalanced = (processor as any).checkInvoiceBalancedAfterFx(
      invoiceMap,
    );

    expect(unbalanced).toEqual(new Set(['9001']));
    expect((processor as any).unbalancedCashInMoneyTypeKeys).toEqual(
      new Set(['9001|transfer']),
    );
    expect((processor as any).unbalancedCashInMoneyTypeKeys.has('9001|cash')).toBe(
      false,
    );
  });

  it('keeps a UniqueId clear when every money-type subgroup balances', () => {
    const processor = createProcessor();
    const invoiceMap = new Map([
      [
        '9002',
        [
          line(9002, { lineNumber: 1, debit: 100, voucherType: 'Cash' }),
          line(9002, { lineNumber: 2, credit: 100, voucherType: 'Cash' }),
          line(9002, { lineNumber: 3, debit: 50, voucherType: 'Cheque' }),
          line(9002, { lineNumber: 4, credit: 50, voucherType: 'Cheque' }),
        ],
      ],
    ]);

    const unbalanced = (processor as any).checkInvoiceBalancedAfterFx(
      invoiceMap,
    );

    expect(unbalanced).toEqual(new Set());
    expect((processor as any).unbalancedCashInMoneyTypeKeys.size).toBe(0);
  });

  it('flags only the unbalanced money-type lines during validateAsync', () => {
    const processor = createProcessor();
    (processor as any).unbalancedCashInMoneyTypeKeys = new Set([
      '9003|transfer',
    ]);
    (processor as any).unbalancedUniqueIds = new Set(['9003']);

    const cashLine = {
      SourceIds: ['9003'],
      VoucherType: 'Cash',
      AddError: jest.fn(),
      AccountType: 'Bank',
    };
    const transferLine = {
      SourceIds: ['9003'],
      VoucherType: 'Transfer',
      AddError: jest.fn(),
      AccountType: 'Cust',
    };

    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    jest
      .spyOn(processor as any, 'validateBankLikeAccountDisplayValues')
      .mockImplementation(() => undefined);

    processor.validateAsync([cashLine, transferLine] as never);

    expect(cashLine.AddError).not.toHaveBeenCalled();
    expect(transferLine.AddError).toHaveBeenCalledWith(
      'UnbalancedInvoice',
      expect.stringContaining('money type Transfer'),
    );
  });
});
