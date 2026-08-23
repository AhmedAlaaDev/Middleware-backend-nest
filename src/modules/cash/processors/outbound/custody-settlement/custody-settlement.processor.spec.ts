import {
  findCustodySettlementWithholdingLine,
  resolveCustodySettlementMarking,
} from './custody-settlement-marking.policy';
import { prepareCustodySettlementLines } from './custody-settlement.processor';
import { CustodySettlementBuilder } from './custody-settlement.builder';
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
  it('creates one output plan per non-withholding source line', () => {
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

    expect(plans).toHaveLength(2);
    expect(plans[0].line.DEBITAMOUNT).toBe(900);
    expect(plans[0].markedLines).toEqual([
      {
        InvoiceNumber: '050-1',
        OperationNumber: 'OP-1',
        DocumentNumber: '15473',
        HasWithHoldingLine: true,
      },
    ]);
    expect(plans[1].isVendorLine).toBe(false);
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

    expect(plans[0].line.DEBITAMOUNT).toBe(900);
    expect(plans[0].markedLines[0].HasWithHoldingLine).toBe(true);
    // Preserve the existing Custody Settlement aggregate amount calculation.
    expect(plans[1].line.DEBITAMOUNT).toBe(900);
    expect(plans[1].markedLines[0].HasWithHoldingLine).toBe(false);
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

  it('marks the supplier invoice and targets the custody credit by document and operation', () => {
    const builder = new CustodySettlementBuilder((_sourceId, sourceLine) =>
      new CashEntryDynDataModel({} as any, {
        AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
        DebitAmount: sourceLine.DEBITAMOUNT,
        CreditAmount: sourceLine.CREDITAMOUNT,
      } as any),
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
  });

  it('keeps a custody credit MarkedLines entry when operation is blank', () => {
    const builder = new CustodySettlementBuilder((_sourceId, sourceLine) =>
      new CashEntryDynDataModel({} as any, {
        AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
        DebitAmount: sourceLine.DEBITAMOUNT,
        CreditAmount: sourceLine.CREDITAMOUNT,
      } as any),
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
