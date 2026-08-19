import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('BaseCashEntryProcessor - PAYMENTMETHOD mapping', () => {
  const utilsService = new EntryProcessorUtilsService();
  const dimensionService = new DimensionValidationService();

  const createProcessor = () => {
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService,
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
      } as any,
    );

    (processor as any).company = 'm-p';
    (processor as any).vendorNameMap = new Map();
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });

    return processor;
  };

  const buildGroup = (
    accountPaymentMethod: string,
    offsetPaymentMethod: string,
  ) =>
    [
      {
        UniqueId: 466672,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: '5019',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1402|014|001|005||||6011||5036|5036|Payable|||EXPORT||||',
        DEBITAMOUNT: 5000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        PAYMENTMETHOD: accountPaymentMethod,
        SALESTAXGROUP: '',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466672,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Petty cash',
        ACCOUNTDISPLAYVALUE: 'PSD EG',
        CREDITAMOUNT: 5000,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        PAYMENTMETHOD: offsetPaymentMethod,
        SALESTAXGROUP: '',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

  it('uses the Excel PAYMENTMETHOD value from the transaction row', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines(
      '466672',
      buildGroup(' 51 ', '51'),
    );

    expect(line.OffsetAccountType).toBe('Petty cash');
    expect(line.OffsetAccountDisplayValue).toBe('PSD EG');
    expect(line.PaymentMethodName).toBe('51');
  });

  it('uses the paired Excel row when only it has PAYMENTMETHOD', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines(
      '466672',
      buildGroup('', ' Petty-Cash-Method '),
    );

    expect(line.PaymentMethodName).toBe('Petty-Cash-Method');
  });

  it('keeps the payment method empty when PAYMENTMETHOD is empty in Excel', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines(
      '466672',
      buildGroup('', '   '),
    );

    expect(line.OffsetAccountType).toBe('Petty cash');
    expect(line.PaymentMethodName).toBe('');
  });

  it('sanitizes date-like values in PAYMENTMETHOD to empty string', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines(
      '466672',
      buildGroup('2026-01-22', '2026-01-22'),
    );

    expect(line.PaymentMethodName).toBe('');
  });
});
