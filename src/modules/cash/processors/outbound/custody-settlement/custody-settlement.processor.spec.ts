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

describe('prepareCustodySettlementLines', () => {
  it('preserves the explicit withholding source line and gross vendor debit', () => {
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
    expect(plans[0].line.DEBITAMOUNT).toBe(1000);
    expect(plans[0].markedLines).toEqual([
      {
        InvoiceNumber: '050-1',
        OperationNumber: 'OP-1',
        DocumentNumber: '15473',
        HasWithHoldingLine: true,
      },
    ]);
    expect(plans[1]).toMatchObject({
      isVendorLine: false,
      isWithholdingLine: true,
      line: {
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304',
        CREDITAMOUNT: 100,
      },
      markedInvoice: '050-1',
      markedLines: [
        {
          InvoiceNumber: '050-1',
          OperationNumber: 'OP-1',
          DocumentNumber: '15473',
          HasWithHoldingLine: false,
        },
      ],
    });
    expect(plans[2].isVendorLine).toBe(false);
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
        CREDITAMOUNT: 100,
      }),
    ]);

    expect(plans[0].line.DEBITAMOUNT).toBe(1000);
    expect(plans[0].markedLines[0].HasWithHoldingLine).toBe(true);
    expect(plans[1].line.DEBITAMOUNT).toBe(1000);
    expect(plans[1].markedLines[0].HasWithHoldingLine).toBe(false);
    expect(plans[2].line.ACCOUNTDISPLAYVALUE).toBe('223304');
    expect(plans[2].markedLines).toEqual([
      {
        InvoiceNumber: 'INV-1',
        OperationNumber: 'OP-1',
        DocumentNumber: '15473',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('uses vendor-payment matching precedence for custody withholding', () => {
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
    ).toBe(withholding);
  });

  it('allocates one withholding row to the correct voucher pair when UniqueId spans invoices', () => {
    const plans = prepareCustodySettlementLines([
      line({
        UniqueId: 492123,
        LINENUMBER: 2809,
        VOUCHER: 'CustSettle-000010285',
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1.16,
        INVOICE: '5810269703',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2810,
        VOUCHER: 'CustSettle-000010285',
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 1.16,
        CREDITAMOUNT: 0,
        INVOICE: '5810269703',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2811,
        VOUCHER: 'CustSettle-000010286',
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 10.87,
        INVOICE: '5815379577',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2812,
        VOUCHER: 'CustSettle-000010286',
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 10.87,
        CREDITAMOUNT: 0,
        INVOICE: '5815379577',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2813,
        VOUCHER: 'CustSettle-000010286',
        ACCOUNTDISPLAYVALUE: '3210',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1474.08,
        INVOICE: '5815379577',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2814,
        VOUCHER: 'CustSettle-000010286',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304|dimensions',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 39.84,
        INVOICE: '',
        DOCUMENT: '18517',
      }),
      line({
        UniqueId: 492123,
        LINENUMBER: 2815,
        VOUCHER: 'CustSettle-000010286',
        ACCOUNTDISPLAYVALUE: 'Sl-000036',
        DEBITAMOUNT: 1513.92,
        CREDITAMOUNT: 0,
        INVOICE: '5815379577',
        DOCUMENT: '18517',
      }),
    ]);

    expect(
      plans.map((plan) => plan.markedLines[0]?.HasWithHoldingLine ?? null),
    ).toEqual([false, false, false, false, true, false, true]);
    expect(plans[5]).toMatchObject({
      isWithholdingLine: true,
      markedInvoice: '5815379577',
      markedLines: [
        {
          InvoiceNumber: '5815379577',
          OperationNumber: 'OP-1',
          DocumentNumber: '18517',
          HasWithHoldingLine: false,
        },
      ],
    });
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
