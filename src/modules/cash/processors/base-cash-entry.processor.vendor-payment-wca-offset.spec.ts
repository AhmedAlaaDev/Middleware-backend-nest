import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

/**
 * Finance tags WCApp payment rows (WCA-US / WCA-EUR) as `Bank`, but D365FO
 * holds them as Ledger main accounts (125901 / 125902). Vendor Payment already
 * emitted the main account as the offset display value while leaving the type
 * `Bank`, so posting validation rejected the line with
 * "Offset account 125901 must be mapped as Ledger, not Bank".
 */
describe('BaseCashEntryProcessor - Vendor Payment WCApp offset account type', () => {
  const createProcessor = () => {
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
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

  const DIMENSIONS =
    '|1201|012|001|002|201000309|201000309|Su-000072|Su-000072|16503|5035|4022|Payable|||EXPORT||||';

  const group = (
    offset: { type: string; account: string },
    safeType = 'Vendor Payment',
    currency = 'USD',
  ) =>
    [
      {
        UniqueId: 537488,
        LINENUMBER: 1,
        TRANSDATE: '2026-07-04',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Ag-000045',
        DEFAULTDIMENSIONDISPLAYVALUE: DIMENSIONS,
        DEBITAMOUNT: 312.77,
        CREDITAMOUNT: 0,
        CURRENCYCODE: currency,
        INVOICE: '104/INV/26/2231',
        DOCUMENT: '22709',
        SALESTAXGROUP: '',
        SafeType: safeType,
        VoucherType: 'Transfer',
      },
      {
        UniqueId: 537488,
        LINENUMBER: 2,
        TRANSDATE: '2026-07-04',
        ACCOUNTTYPE: offset.type,
        ACCOUNTDISPLAYVALUE: offset.account,
        DEFAULTDIMENSIONDISPLAYVALUE: '',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 312.77,
        CURRENCYCODE: currency,
        SALESTAXGROUP: '',
        SafeType: safeType,
        VoucherType: 'Transfer',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

  const buildVendorPaymentLine = (offset: {
    type: string;
    account: string;
  }) => {
    const [line] = (createProcessor() as any).buildLines(
      '537488',
      group(offset),
    );
    return line;
  };

  /** Runs the line through the real posting-time validation. */
  const postingErrors = (line: any): string[] => {
    const handler: any = new PostCashBatchToDFOHandler(
      {} as any,
      {} as any,
      new CashJournalRoutingService(),
    );
    line.JournalBatchNumber = '1';
    try {
      const mapped = handler.mapToD365FOCashJournalRequests(
        new Map([['1', [{ data: line }]]]),
        'm-p',
        'out',
        'Freight',
      );
      handler.validateCustomerPaymentJournals(mapped);
      return [];
    } catch (error: any) {
      return [String(error?.getResponse?.()?.details ?? error?.message)];
    }
  };

  describe('Vendor Payment', () => {
    it.each([
      ['WCA-US', '125901'],
      ['WCA-EUR', '125902'],
      ['125901', '125901'],
      ['125902', '125902'],
    ])(
      'maps a Bank-tagged %s payment row to Ledger main account %s',
      (source, mainAccount) => {
        const line = buildVendorPaymentLine({ type: 'Bank', account: source });

        expect(line.OffsetAccountType).toBe('Ledger');
        expect(line.OffsetAccountDisplayValue).toBe(mainAccount);
        expect(line.AccountType).toBe('Vend');
        expect(line.DebitAmount).toBe(312.77);
        expect(line.GetErrors()).toEqual([]);
        expect(postingErrors(line)).toEqual([]);
      },
    );

    it('keeps a regular bank account as Bank', () => {
      const line = buildVendorPaymentLine({
        type: 'Bank',
        account: 'QNB-EU-CA2',
      });

      expect(line.OffsetAccountType).toBe('Bank');
      expect(line.OffsetAccountDisplayValue).toBe('QNB-EU-CA2');
      expect(postingErrors(line)).toEqual([]);
    });

    it('keeps a real ledger offset as Ledger', () => {
      const line = buildVendorPaymentLine({
        type: 'Ledger',
        account:
          '223201|1201|012|001|002|201000293|201000293|Su-000072|Su-000072|16503|5035|4022|Payable|||EXPORT||||',
      });

      expect(line.OffsetAccountType).toBe('Ledger');
      expect(postingErrors(line)).toEqual([]);
    });

    it('keeps a Petty cash offset as Petty cash', () => {
      const line = buildVendorPaymentLine({
        type: 'Petty cash',
        account: 'PSD EG',
      });

      expect(line.OffsetAccountType).toBe('Petty cash');
      expect(postingErrors(line)).toEqual([]);
    });

    it('does not guess a type for an unknown account tagged Bank', () => {
      const line = buildVendorPaymentLine({ type: 'Bank', account: '125903' });

      expect(line.OffsetAccountType).toBe('Bank');
      expect(line.OffsetAccountDisplayValue).toBe('125903');
    });
  });

  describe('Custody Settlement (unchanged)', () => {
    it('keeps the source offset type for a Bank-tagged WCA-US row', () => {
      const processor: any = createProcessor();
      const [vendor, offset] = group(
        { type: 'Bank', account: 'WCA-US' },
        'Custody Settlement',
      );

      const line = processor.buildLineOutbound(
        '537488',
        vendor,
        offset,
        'ACCOUNT',
      );

      expect(line.OffsetAccountType).toBe('Bank');
      // The posting guard keeps rejecting this shape for Custody Settlement.
      expect(postingErrors(line).join(' ')).toContain(
        'must be mapped as Ledger, not Bank',
      );
    });

    it('keeps a regular bank offset as Bank', () => {
      const processor: any = createProcessor();
      const [vendor, offset] = group(
        { type: 'Bank', account: 'QNB-EU-CA2' },
        'Custody Settlement',
      );

      const line = processor.buildLineOutbound(
        '537488',
        vendor,
        offset,
        'ACCOUNT',
      );

      expect(line.OffsetAccountType).toBe('Bank');
      expect(line.OffsetAccountDisplayValue).toBe('QNB-EU-CA2');
    });
  });
});
