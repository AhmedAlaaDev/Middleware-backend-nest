import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('BaseCashEntryProcessor - PBI #2039 22420 filtering', () => {
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

  const group466765 = [
    {
      UniqueId: 466765,
      LINENUMBER: '7.0000000000000000',
      JOURNALNAME: 'NP',
      DESCRIPTION: 'QNB_EG_CA1-1',
      VOUCHER: 'NP-000125290',
      TRANSDATE: '2026-01-01',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: '6011',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1402|014|001|005|101000064|101000064|6011|6011||5036|5036|Payable|||EXPORT||||',
      FINTAGDISPLAYVALUE: 'O25-EXP-OC-12574|Q-1|RP-000007',
      DEBITAMOUNT: 450,
      CREDITAMOUNT: 0,
      CURRENCYCODE: 'EGP',
      INVOICE: 'EGDAMAD250016114',
      POSTINGPROFILE: 'V-PP',
      SALESTAXGROUP: '',
      SafeType: 'Custody Issue',
      VoucherType: 'Transfer',
    },
    {
      UniqueId: 466765,
      LINENUMBER: '8.0000000000000000',
      JOURNALNAME: 'NP',
      DESCRIPTION: 'QNB_EG_CA1-1',
      VOUCHER: 'NP-000125290',
      TRANSDATE: '2026-01-01',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: '6011',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1402|014|001|005|101000064|101000064|6011|6011||5036|5036|Payable|||EXPORT||||',
      FINTAGDISPLAYVALUE: 'O25-EXP-OC-12574|Q-1|RP-000007',
      DEBITAMOUNT: 10500,
      CREDITAMOUNT: 0,
      CURRENCYCODE: 'EGP',
      INVOICE: 'EGDAMAX250056484',
      POSTINGPROFILE: 'V-PP',
      SALESTAXGROUP: '',
      SafeType: 'Custody Issue',
      VoucherType: 'Transfer',
    },
    {
      UniqueId: 466765,
      LINENUMBER: '9.0000000000000000',
      JOURNALNAME: 'NP',
      DESCRIPTION: 'QNB_EG_CA1-1',
      VOUCHER: 'NP-000125290',
      TRANSDATE: '2026-01-01',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: '6011',
      DEFAULTDIMENSIONDISPLAYVALUE:
        '|1402|014|001|005|101000064|101000064|6011|6011||5036|5036|Payable|||EXPORT||||',
      FINTAGDISPLAYVALUE: 'O25-EXP-OC-12574|Q-1|RP-000007',
      DEBITAMOUNT: 450,
      CREDITAMOUNT: 0,
      CURRENCYCODE: 'EGP',
      INVOICE: 'EGDAMAX250056858',
      POSTINGPROFILE: 'V-PP',
      SALESTAXGROUP: '',
      SafeType: 'Custody Issue',
      VoucherType: 'Transfer',
    },
    {
      UniqueId: 466765,
      LINENUMBER: '10.0000000000000000',
      JOURNALNAME: 'NP',
      DESCRIPTION: 'QNB_EG_CA1-1',
      VOUCHER: 'NP-000125290',
      TRANSDATE: '2026-01-01',
      ACCOUNTTYPE: 'Ledger',
      ACCOUNTDISPLAYVALUE:
        '224209|1402|014|001|005|101000064|101000064||6011||5036|5036|Payable|||EXPORT||||',
      // Real data has a non-22420 tag; the Ledger account is the OR trigger.
      FINTAGDISPLAYVALUE: 'O25-EXP-OC-12574|Q-1|RP-000007',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 11400,
      CURRENCYCODE: 'EGP',
      SALESTAXGROUP: 'Taxable',
      SafeType: 'Custody Issue',
      VoucherType: 'Transfer',
    },
  ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

  it('filters non-core dimensions when a cash offset Ledger account starts with 22420', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('466765', group466765);

    expect(result).toHaveLength(3);
    for (const line of result) {
      expect(line.AccountType).toBe('Vend');
      expect(line.OffsetAccountType).toBe('Ledger');
      expect(line.OffsetAccountDisplayValue).toMatch(/^224209\|/);

      // Existing cash rule remaps 224209 to 223201 after the 22420 trigger.
      expect(line.DimensionModel.mainAccount).toBe('223201');
      expect(line.DimensionModel.costCenter).toBe('1402');
      expect(line.DimensionModel.activityName).toBe('014');
      expect(line.DimensionModel.businessUnit).toBe('001');
      expect(line.DimensionModel.location).toBe('005');

      expect(line.DimensionModel.customer).toBeUndefined();
      expect(line.DimensionModel.subCustomer).toBeUndefined();
      expect(line.DimensionModel.subVendor).toBeUndefined();
      expect(line.DimensionModel.chargeType).toBeUndefined();
      expect(line.DimensionModel.salesMan).toBeUndefined();
      expect(line.DimensionModel.coordinatorMan).toBeUndefined();
      expect(line.DimensionModel.freightType).toBeUndefined();
      expect(line.DimensionModel.direction).toBeUndefined();
      expect(line.DefaultDimensionDisplayValue).not.toContain('Payable');
      expect(line.OffsetDefaultDimensionDisplayValue).not.toContain(
        'Payable',
      );
    }
  });

  it('exempts the dropped cash-offset fields from required-dimension validation', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('466765', group466765);

    (processor as any).dimensionsMap = new Map([
      ['Activity', new Set(['014'])],
      ['CostCenters', new Set(['1402'])],
      ['BusinessUnit', new Set(['001'])],
      ['Location', new Set(['005'])],
      ['Customer', new Set()],
      ['SubCustomer', new Set()],
      ['ChargeType', new Set()],
      ['SalesMan', new Set()],
      ['CoordinatorMan', new Set()],
      ['FreightType', new Set(['payable'])],
      ['Direction', new Set()],
    ]);
    (processor as any).accountNumberSet = new Set();

    (processor as any).validateDimensionsForLine(line);

    expect(line.errors).toEqual([]);
  });
});
