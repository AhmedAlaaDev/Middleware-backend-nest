import {
  findCustodySettlementWithholdingLine,
  resolveCustodySettlementMarking,
} from './custody-settlement-marking.policy';
import { CustodySettlementBuilder } from './custody-settlement.builder';
import { prepareCustodySettlementLines } from './custody-settlement.processor';
import { validateCustodySettlementVendorInvoiceShape } from './custody-settlement.validator';

import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

function line(
  overrides: Partial<CashEntryRawDataModel>,
): CashEntryRawDataModel {
  return Object.assign(Object.create(CashEntryRawDataModel.prototype), {
    UniqueId: 10,
    LINENUMBER: 1,
    SafeType: 'Custody Settlement',
    ACCOUNTTYPE: 'Vend',
    ACCOUNTDISPLAYVALUE: 'RP-000003',
    DEBITAMOUNT: 1000,
    CREDITAMOUNT: 0,
    CURRENCYCODE: 'EGP',
    DOCUMENT: '15473',
    INVOICE: '050-1',
    FINTAGDISPLAYVALUE: 'OP-1|OTHER',
    ...overrides,
  }) as CashEntryRawDataModel;
}

/**
 * UniqueId 489567 from the WHT custody settlement source: the vendor gross of
 * 23,940 is 21,000 net, and WHT-3% of that net is the 630 on the 223304 row.
 */
function withholdingJournalLines(): CashEntryRawDataModel[] {
  const shared = { INVOICE: '82_1', DOCUMENT: '18254' };
  return [
    line({
      ...shared,
      LINENUMBER: 1,
      ACCOUNTTYPE: 'Petty Cash',
      ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
      DEBITAMOUNT: 18690,
      CREDITAMOUNT: 0,
    }),
    line({
      ...shared,
      LINENUMBER: 2,
      ACCOUNTDISPLAYVALUE: 'Tr-000054',
      DEBITAMOUNT: 23940,
      CREDITAMOUNT: 0,
      ISWITHHOLDINGCALCULATIONENABLED: 'No',
    }),
    line({
      ...shared,
      LINENUMBER: 3,
      ACCOUNTTYPE: 'Ledger',
      ACCOUNTDISPLAYVALUE: '223304|1601|016|001|003',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 630,
      ISWITHHOLDINGCALCULATIONENABLED: 'Yes',
      ITEMWITHHOLDINGTAXGROUPCODE: 'WHT-3%',
    }),
    line({
      ...shared,
      LINENUMBER: 4,
      ACCOUNTDISPLAYVALUE: '3098',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 42000,
    }),
  ];
}

describe('prepareCustodySettlementLines', () => {
  it('posts 223304 as the withholding offset of its vendor line', () => {
    const plans = prepareCustodySettlementLines([
      line({ LINENUMBER: 1, DEBITAMOUNT: 1000 }),
      line({
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        ISWITHHOLDINGCALCULATIONENABLED: 'Yes',
      }),
      line({ LINENUMBER: 3, ACCOUNTTYPE: 'Ledger', DEBITAMOUNT: 50 }),
    ]);

    expect(plans).toHaveLength(3);
    const [withholding, vendor, ledger] = plans;

    expect(withholding.isVendorLine).toBe(true);
    expect(withholding.line.ACCOUNTTYPE).toBe('Vend');
    expect(withholding.line.ACCOUNTDISPLAYVALUE).toBe('RP-000003');
    expect(withholding.line.DEBITAMOUNT).toBe(100);
    expect(withholding.line.CREDITAMOUNT).toBe(0);
    expect(withholding.line.OFFSETACCOUNTTYPE).toBe('Ledger');
    expect(withholding.line.OFFSETACCOUNTDISPLAYVALUE).toBe('223304');
    // Traceable back to the withholding row of the source file.
    expect(withholding.line.LINENUMBER).toBe(2);

    // 900 + 100 still settles the 1000 gross invoice.
    expect(vendor.line.DEBITAMOUNT).toBe(900);
    expect(vendor.line.OFFSETACCOUNTDISPLAYVALUE).toBe('');
    expect(vendor.markedLines).toEqual([
      {
        InvoiceNumber: '050-1',
        OperationNumber: 'OP-1',
        DocumentNumber: '15473',
        HasWithHoldingLine: true,
      },
    ]);

    expect(ledger.isVendorLine).toBe(false);
    expect(ledger.line.ACCOUNTTYPE).toBe('Ledger');
    expect(ledger.line.DEBITAMOUNT).toBe(50);
    expect(ledger.line.OFFSETACCOUNTTYPE).toBe('');
  });

  it('posts a 223304 row that carries a tax group as the vendor offset', () => {
    const plans = prepareCustodySettlementLines(withholdingJournalLines());

    expect(
      plans.map(({ line: outputLine }) => outputLine.ACCOUNTDISPLAYVALUE),
    ).toEqual(['ALEXHO EG', 'Tr-000054', 'Tr-000054', '3098']);

    const withholding = plans[1];
    expect(withholding.isVendorLine).toBe(true);
    expect(withholding.line.DEBITAMOUNT).toBe(630);
    expect(withholding.line.OFFSETACCOUNTDISPLAYVALUE).toBe(
      '223304|1601|016|001|003',
    );
    expect(withholding.line.ISWITHHOLDINGCALCULATIONENABLED).toBe('No');
    expect(withholding.line.ITEMWITHHOLDINGTAXGROUPCODE).toBeUndefined();

    // 23,310 + 630 is the 23,940 gross vendor debit from the source.
    const vendor = plans[2];
    expect(vendor.line.ISWITHHOLDINGCALCULATIONENABLED).toBe('No');
    expect(vendor.line.ITEMWITHHOLDINGTAXGROUPCODE).toBeUndefined();
    expect(vendor.line.DEBITAMOUNT).toBe(23310);
    expect(vendor.markedLines[0].HasWithHoldingLine).toBe(true);
  });

  it('builds the withholding as a vendor line whose offset is 223304', () => {
    const builder = new CustodySettlementBuilder(
      (_sourceId, sourceLine) =>
        new CashEntryDynDataModel(
          {} as any,
          {
            AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
            OffsetAccountType: sourceLine.OFFSETACCOUNTTYPE,
            OffsetAccountDisplayValue: sourceLine.OFFSETACCOUNTDISPLAYVALUE,
            DebitAmount: sourceLine.DEBITAMOUNT,
            CreditAmount: sourceLine.CREDITAMOUNT,
          } as any,
        ),
    );

    const built = builder.build('source-489567', withholdingJournalLines());

    expect(built).toHaveLength(4);
    const withholding = built.find(({ OffsetAccountDisplayValue }) =>
      String(OffsetAccountDisplayValue).startsWith('223304'),
    );
    expect(withholding?.AccountDisplayValue).toBe('Tr-000054');
    expect(withholding?.OffsetAccountType).toBe('Ledger');
    expect(withholding?.DebitAmount).toBe(630);
    expect(withholding?.IsWithholdingCalculationEnabled).toBe('No');
    expect(withholding?.ItemWithholdingTaxGroupCode).toBe('');

    const vendor = built.find(
      (dynLine) =>
        dynLine.AccountDisplayValue === 'Tr-000054' &&
        !dynLine.OffsetAccountDisplayValue,
    );
    expect(vendor?.IsWithholdingCalculationEnabled).toBe('No');
    expect(vendor?.ItemWithholdingTaxGroupCode).toBe('');
    expect(vendor?.DebitAmount).toBe(23310);
    expect(vendor?.MarkedLines[0].HasWithHoldingLine).toBe(true);

    const custodyCredit = built.find(
      ({ AccountDisplayValue }) => AccountDisplayValue === '3098',
    );
    expect(custodyCredit?.IsWithholdingCalculationEnabled).toBe('No');
    expect(custodyCredit?.ItemWithholdingTaxGroupCode).toBe('');
  });

  it('does not mark a vendor line when invoice or document is absent', () => {
    const plans = prepareCustodySettlementLines([
      line({ INVOICE: '', DOCUMENT: '' }),
    ]);

    expect(plans[0].markedInvoice).toBe('');
    expect(plans[0].markedLines).toEqual([]);
  });

  it('does not create a partial marked line when only the document is absent', () => {
    const plans = prepareCustodySettlementLines([
      line({ INVOICE: '050-1', DOCUMENT: '' }),
    ]);

    expect(plans[0].markedInvoice).toBe('');
    expect(plans[0].markedLines).toEqual([]);
  });

  it('does not fall back from a zero or blank invoice to the document number', () => {
    const plans = prepareCustodySettlementLines([
      line({ MARKEDINVOICE: '0', INVOICE: '', DOCUMENT: '16826' }),
    ]);

    expect(plans[0].markedInvoice).toBe('');
    expect(plans[0].markedLines).toEqual([]);
  });

  it('allows an unmarked Custody Settlement VendorInvoice request', () => {
    const dynLine = new CashEntryDynDataModel(
      {} as any,
      {
        SafeType: 'Custody Settlement',
        SettlementTargetType: 'VendorInvoice',
        SettlementIntent: 'Unmarked',
        AccountDisplayValue: '5025',
        Document: '16826',
        CreditAmount: 12000,
        MarkedLines: [],
      } as any,
    );

    expect(validateCustodySettlementVendorInvoiceShape(dynLine)).toEqual([]);
  });

  it('requires invoice and document identity when Custody Settlement is marked', () => {
    const dynLine = new CashEntryDynDataModel(
      {} as any,
      {
        SafeType: 'Custody Settlement',
        SettlementTargetType: 'VendorInvoice',
        SettlementIntent: 'Marked',
        AccountDisplayValue: '5025',
        MarkedLines: [
          {
            InvoiceNumber: '',
            OperationNumber: 'OP-1',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
      } as any,
    );

    expect(validateCustodySettlementVendorInvoiceShape(dynLine)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'MarkedInvoice' }),
        expect.objectContaining({ field: 'DocumentNumber' }),
      ]),
    );
  });

  it('extracts OperationNumber from the first cleaned financial-tag segment', () => {
    const marking = resolveCustodySettlementMarking({
      vendorLine: line({ FINTAGDISPLAYVALUE: '\u200e OP-778 |BRANCH|OTHER' }),
    });

    expect(marking.markedLines).toEqual([
      {
        InvoiceNumber: '050-1',
        OperationNumber: 'OP-778',
        DocumentNumber: '15473',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('flags withholding only on the matching vendor line', () => {
    const plans = prepareCustodySettlementLines([
      line({ UniqueId: 101, LINENUMBER: 1, INVOICE: 'INV-1' }),
      line({
        UniqueId: 202,
        LINENUMBER: 2,
        INVOICE: 'INV-2',
        DOCUMENT: 'DOC-2',
        FINTAGDISPLAYVALUE: 'OP-2|OTHER',
      }),
      line({
        UniqueId: 101,
        LINENUMBER: 3,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        INVOICE: 'INV-1',
      }),
    ]);

    const [withholding, firstVendor, secondVendor] = plans;

    expect(withholding.line.INVOICE).toBe('INV-1');
    expect(withholding.line.DEBITAMOUNT).toBe(100);
    expect(withholding.line.OFFSETACCOUNTDISPLAYVALUE).toBe('223304');
    expect(firstVendor.line.DEBITAMOUNT).toBe(900);
    expect(firstVendor.markedLines[0].HasWithHoldingLine).toBe(true);
    // The unrelated vendor does not inherit another vendor's withholding.
    expect(secondVendor.line.DEBITAMOUNT).toBe(1000);
    expect(secondVendor.line.OFFSETACCOUNTDISPLAYVALUE).toBe('');
    expect(secondVendor.markedLines[0].HasWithHoldingLine).toBe(false);
  });

  it('allocates one shared withholding row once to the amount-compatible custody debit', () => {
    const plans = prepareCustodySettlementLines([
      line({
        LINENUMBER: 839,
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 0.18,
        INVOICE: '5815372458',
      }),
      line({
        LINENUMBER: 840,
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 0.18,
        CREDITAMOUNT: 0,
        INVOICE: '5815372458',
      }),
      line({
        LINENUMBER: 841,
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 290.82,
        INVOICE: '5815372458',
      }),
      line({
        LINENUMBER: 842,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304|dimensions',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 7.86,
        INVOICE: '',
      }),
      line({
        LINENUMBER: 843,
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 298.68,
        CREDITAMOUNT: 0,
        INVOICE: '5815372458',
      }),
    ]);

    const withholdingOffsets = plans.filter(({ line: outputLine }) =>
      String(outputLine.OFFSETACCOUNTDISPLAYVALUE ?? '').startsWith('223304'),
    );
    const vendorDebits = plans.filter(
      ({ line: outputLine }) =>
        outputLine.ACCOUNTTYPE === 'Vend' &&
        Number(outputLine.DEBITAMOUNT ?? 0) > 0,
    );

    expect(plans).toHaveLength(5);
    expect(withholdingOffsets).toHaveLength(1);
    expect(withholdingOffsets[0].line.DEBITAMOUNT).toBe(7.86);
    expect(withholdingOffsets[0].line.ACCOUNTDISPLAYVALUE).toBe('Sl-000036');
    expect(withholdingOffsets[0].line.INVOICE).toBe('5815372458');
    // 290.82 + 7.86 is the 298.68 source debit of the compatible vendor row.
    expect(vendorDebits.map(({ line: outputLine }) => Number(outputLine.DEBITAMOUNT))).toEqual(
      expect.arrayContaining([0.18, 7.86, 290.82]),
    );
    expect(
      vendorDebits.find(
        ({ line: outputLine }) => Number(outputLine.DEBITAMOUNT) === 0.18,
      )?.markedLines[0].HasWithHoldingLine,
    ).toBe(false);
    expect(
      vendorDebits.find(
        ({ line: outputLine }) => Number(outputLine.DEBITAMOUNT) === 290.82,
      )?.markedLines[0].HasWithHoldingLine,
    ).toBe(true);
  });

  it('does not attach a withholding row from another invoice in the same UniqueId', () => {
    const withholding = line({
      UniqueId: 77,
      ACCOUNTTYPE: 'Ledger',
      ACCOUNTDISPLAYVALUE: '223304',
      INVOICE: 'DIFFERENT',
    });

    expect(
      findCustodySettlementWithholdingLine(
        line({ UniqueId: 77, INVOICE: 'INV-1' }),
        [withholding],
      ),
    ).toBeUndefined();
  });

  it('matches withholding by invoice when several invoices share one UniqueId', () => {
    const plans = prepareCustodySettlementLines([
      line({
        UniqueId: 475848,
        LINENUMBER: 1,
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1.59,
        INVOICE: '5810265983',
      }),
      line({
        UniqueId: 475848,
        LINENUMBER: 2,
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 1.59,
        CREDITAMOUNT: 0,
        INVOICE: '5810265983',
      }),
      line({
        UniqueId: 475848,
        LINENUMBER: 3,
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 33.2889,
        INVOICE: '5815371117',
      }),
      line({
        UniqueId: 475848,
        LINENUMBER: 4,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 0.9,
        INVOICE: '5815371117',
      }),
      line({
        UniqueId: 475848,
        LINENUMBER: 5,
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 34.1886,
        CREDITAMOUNT: 0,
        INVOICE: '5815371117',
      }),
    ]);

    const vendorByInvoice = Object.fromEntries(
      plans
        .filter(
          ({ line: outputLine }) =>
            outputLine.ACCOUNTTYPE === 'Vend' &&
            Number(outputLine.DEBITAMOUNT ?? 0) > 0,
        )
        .map((plan) => [plan.line.INVOICE, plan.markedLines[0]?.HasWithHoldingLine]),
    );

    expect(vendorByInvoice['5810265983']).toBe(false);
    expect(vendorByInvoice['5815371117']).toBe(true);
  });

  it('keeps Excel amount precision when withholding moves to its offset', () => {
    const plans = prepareCustodySettlementLines([
      line({
        LINENUMBER: 16,
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 33.2889,
        INVOICE: '5815371117',
        CURRENCYCODE: 'USD',
      }),
      line({
        LINENUMBER: 17,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304|1601',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 0.9,
        INVOICE: '5815371117',
        CURRENCYCODE: 'USD',
      }),
      line({
        LINENUMBER: 18,
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 34.1886,
        CREDITAMOUNT: 0,
        INVOICE: '5815371117',
        CURRENCYCODE: 'USD',
      }),
    ]);

    const withholding = plans.find(({ line: outputLine }) =>
      String(outputLine.OFFSETACCOUNTDISPLAYVALUE ?? '').startsWith('223304'),
    );
    const vendorDebit = plans.find(
      ({ line: outputLine }) =>
        outputLine.ACCOUNTDISPLAYVALUE === 'Sl-000036' &&
        !outputLine.OFFSETACCOUNTDISPLAYVALUE,
    );
    const custodyCredit = plans.find(
      ({ line: outputLine }) => outputLine.ACCOUNTDISPLAYVALUE === '3210',
    );

    // 33.2886 keeps the source precision; 2-decimal rounding would move money.
    expect(vendorDebit?.line.DEBITAMOUNT).toBe(33.2886);
    expect(custodyCredit?.line.CREDITAMOUNT).toBe(33.2889);
    expect(withholding?.line.DEBITAMOUNT).toBe(0.9);
    expect(withholding?.isVendorLine).toBe(true);
  });

  it('marks the supplier invoice and targets the custody credit by document and operation', () => {
    const builder = new CustodySettlementBuilder(
      (_sourceId, sourceLine) =>
        new CashEntryDynDataModel(
          {} as any,
          {
            AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
            DebitAmount: sourceLine.DEBITAMOUNT,
            CreditAmount: sourceLine.CREDITAMOUNT,
          } as any,
        ),
    );

    const [supplier, custodyHolder] = builder.build('source-1', [
      line({
        LINENUMBER: 1,
        ACCOUNTDISPLAYVALUE: 'Su-000019',
        DEBITAMOUNT: 8135.04,
        CREDITAMOUNT: 0,
        INVOICE: 'IA2025120309022485',
        DOCUMENT: '14846',
      }),
      line({
        LINENUMBER: 2,
        ACCOUNTDISPLAYVALUE: '3135',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 8500,
        INVOICE: 'IA2025120309022485',
        DOCUMENT: '14846',
        IsCustodyVendor: true,
      }),
    ]);

    expect(supplier.MarkedInvoice).toBe('IA2025120309022485');
    expect(supplier.MarkedLines).toEqual([
      {
        InvoiceNumber: 'IA2025120309022485',
        OperationNumber: 'OP-1',
        DocumentNumber: '14846',
        HasWithHoldingLine: false,
      },
    ]);
    expect(supplier.SettlementIntent).toBe('Marked');
    expect(supplier.SettlementTargetType).toBe('VendorInvoice');
    expect(custodyHolder.MarkedInvoice).toBe('');
    expect(custodyHolder.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'OP-1',
        DocumentNumber: '14846',
        HasWithHoldingLine: false,
      },
    ]);
    expect(custodyHolder.SettlementIntent).toBe('Marked');
    expect(custodyHolder.SettlementTargetType).toBe('CustodyLedger');
    expect(custodyHolder.VendorGroup).toBe('Custody');
  });

  it('keeps a custody credit MarkedLines entry when operation is blank', () => {
    const builder = new CustodySettlementBuilder(
      (_sourceId, sourceLine) =>
        new CashEntryDynDataModel(
          {} as any,
          {
            AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
            DebitAmount: sourceLine.DEBITAMOUNT,
            CreditAmount: sourceLine.CREDITAMOUNT,
          } as any,
        ),
    );

    const [custodyHolder] = builder.build('source-2', [
      line({
        ACCOUNTDISPLAYVALUE: '5025',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 15000,
        DOCUMENT: '20432',
        FINTAGDISPLAYVALUE: '',
        ResolvedD365InvoiceNumber: '',
        IsCustodyVendor: true,
      }),
    ]);

    expect(custodyHolder.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: '',
        DocumentNumber: '20432',
        HasWithHoldingLine: false,
      },
    ]);
    expect(custodyHolder.SettlementIntent).toBe('Marked');
  });
});
