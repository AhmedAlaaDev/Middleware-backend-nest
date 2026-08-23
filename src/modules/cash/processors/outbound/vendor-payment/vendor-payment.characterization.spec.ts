import { VendorPaymentMarkingResult } from './models/vendor-payment-marking-result';
import { VendorInvoiceMatchStatus } from './models/vendor-invoice-match-result';
import { classifyVendorPaymentLines } from './policies/vendor-payment-line.policy';
import { resolveVendorPaymentMarking } from './policies/vendor-payment-marked-lines.policy';
import { VendorPaymentBuilder } from './vendor-payment.builder';
import { VendorPaymentDirector } from './vendor-payment.director';
import { validateVendorPaymentSemantics } from './vendor-payment.semantic-validator';
import { validateVendorPaymentStructure } from './vendor-payment.structural-validator';

function rawLine(overrides: Record<string, any> = {}): any {
  return {
    LINENUMBER: 1,
    UniqueId: 1,
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    ACCOUNTTYPE: 'Vendor',
    ACCOUNTDISPLAYVALUE: 'VEND-001',
    OFFSETACCOUNTTYPE: 'Bank',
    OFFSETACCOUNTDISPLAYVALUE: 'BANK-001',
    DEFAULTDIMENSIONDISPLAYVALUE: '',
    CURRENCYCODE: 'EGP',
    TRANSDATE: '2026-01-15',
    DOCUMENT: 'DOC-001',
    INVOICE: 'INV-001',
    MARKEDINVOICE: '',
    FINTAGDISPLAYVALUE: 'OP-1||',
    ISWITHHOLDINGCALCULATIONENABLED: '',
    ITEMWITHHOLDINGTAXGROUPCODE: '',
    DESCRIPTION: 'Test payment',
    VoucherType: 'Cash',
    SafeType: 'Vendor Payment',
    VendorGroup: 'Normal',
    IsVendor: true,
    IsVendorPayment: true,
    IsCustodyVendor: false,
    IsCustodySettlement: false,
    PAYMENTMETHOD: '',
    PAYMENTREFERENCE: '',
    POSTINGPROFILE: '',
    DOCUMENTDATE: '2026-01-15',
    DUEDATE: '2026-02-15',
    SALESTAXGROUP: 'Non-Taxabl',
    ITEMSALESTAXGROUP: '',
    OFFSETFINTAGDISPLAYVALUE: '',
    OFFSETDEFAULTDIMENSIONDISPLAYVALUE: '',
    OFFSETTEXT: '',
    TEXT: '',
    ...overrides,
  };
}

describe('Vendor Payment Classification (Line Policy)', () => {
  it('classifies a standard vendor payment group', () => {
    const lines = [
      rawLine({ DEBITAMOUNT: 1000 }),
      rawLine({ DEBITAMOUNT: 0, CREDITAMOUNT: 1000, IsVendor: false }),
    ];

    const result = classifyVendorPaymentLines(lines);
    expect(result.vendorDebitLines).toHaveLength(1);
    expect(result.paymentOffset).toBeDefined();
    expect(result.withholdingLines).toHaveLength(0);
    expect(result.invalidDebitLines).toHaveLength(0);
  });

  it('classifies multiple vendor debit lines', () => {
    const lines = [
      rawLine({ DEBITAMOUNT: 500, LINENUMBER: 1 }),
      rawLine({ DEBITAMOUNT: 500, LINENUMBER: 2 }),
      rawLine({ DEBITAMOUNT: 0, CREDITAMOUNT: 1000, IsVendor: false }),
    ];

    const result = classifyVendorPaymentLines(lines);
    expect(result.vendorDebitLines).toHaveLength(2);
    expect(result.paymentOffset).toBeDefined();
  });

  it('detects invalid non-vendor debit lines', () => {
    const lines = [
      rawLine({ DEBITAMOUNT: 500 }),
      rawLine({ DEBITAMOUNT: 300, IsVendor: false, ACCOUNTTYPE: 'Ledger' }),
      rawLine({ DEBITAMOUNT: 0, CREDITAMOUNT: 800, IsVendor: false }),
    ];

    const result = classifyVendorPaymentLines(lines);
    expect(result.vendorDebitLines).toHaveLength(1);
    expect(result.invalidDebitLines).toHaveLength(1);
  });
});

describe('Vendor Payment Structural Validation', () => {
  it('passes for valid structure', () => {
    const classification = classifyVendorPaymentLines([
      rawLine({ DEBITAMOUNT: 1000 }),
      rawLine({ DEBITAMOUNT: 0, CREDITAMOUNT: 1000, IsVendor: false }),
    ]);

    const errors = validateVendorPaymentStructure(classification, 'VP-001');
    expect(errors).toHaveLength(0);
  });

  it('fails when no vendor debit lines', () => {
    const classification = classifyVendorPaymentLines([
      rawLine({ DEBITAMOUNT: 0, CREDITAMOUNT: 1000, IsVendor: false }),
    ]);

    const errors = validateVendorPaymentStructure(classification, 'VP-001');
    expect(errors.some((e) => e.field === 'VendorLines')).toBe(true);
  });

  it('fails when no payment offset', () => {
    const classification = classifyVendorPaymentLines([
      rawLine({ DEBITAMOUNT: 1000 }),
    ]);

    const errors = validateVendorPaymentStructure(classification, 'VP-001');
    expect(errors.some((e) => e.field === 'PaymentOffset')).toBe(true);
  });
});

describe('Vendor Payment Marked Lines Policy', () => {
  it('produces marked result for normal vendor payment', () => {
    const vendorLine = rawLine({
      DEBITAMOUNT: 1000,
      INVOICE: 'INV-100',
      DOCUMENT: 'DOC-100',
    });
    const offsetLine = rawLine({ CREDITAMOUNT: 1000 });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine }],
      offsetLine,
      vendorGroup: 'Normal',
    });

    expect(result.shouldMark).toBe(true);
    expect(result.markedLines).toHaveLength(1);
    expect(result.markedLines[0].InvoiceNumber).toBe('INV-100');
    expect(result.markedLines[0].DocumentNumber).toBe('DOC-100');
    expect(result.markedLines[0].HasWithHoldingLine).toBe(false);
    expect(result.markedInvoice).toBe('INV-100');
  });

  it('produces marked result with withholding enabled via flags without explicit withholding row', () => {
    const vendorLine = rawLine({
      DEBITAMOUNT: 1000,
      INVOICE: 'INV-201',
      ISWITHHOLDINGCALCULATIONENABLED: 'Yes',
      ITEMWITHHOLDINGTAXGROUPCODE: 'WHT',
    });
    const offsetLine = rawLine({ CREDITAMOUNT: 1000 });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine }],
      offsetLine,
      vendorGroup: 'Normal',
    });

    expect(result.shouldMark).toBe(true);
    expect(result.markedLines[0].HasWithHoldingLine).toBe(true);
  });

  it('produces marked result with withholding', () => {
    const vendorLine = rawLine({ DEBITAMOUNT: 1000, INVOICE: 'INV-200' });
    const withholdingLine = rawLine({ ACCOUNTDISPLAYVALUE: '223304' });
    const offsetLine = rawLine({ CREDITAMOUNT: 1000 });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine, withholdingLine }],
      offsetLine,
      vendorGroup: 'Normal',
    });

    expect(result.shouldMark).toBe(true);
    expect(result.markedLines[0].HasWithHoldingLine).toBe(true);
  });

  it('produces unmarked result when invoice is blank/zero', () => {
    const vendorLine = rawLine({
      DEBITAMOUNT: 1000,
      INVOICE: '',
      DOCUMENT: '',
      MARKEDINVOICE: '',
    });
    const offsetLine = rawLine({
      CREDITAMOUNT: 1000,
      INVOICE: '',
      DOCUMENT: '',
      MARKEDINVOICE: '',
    });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine }],
      offsetLine,
      vendorGroup: 'Normal',
    });

    expect(result.shouldMark).toBe(false);
    expect(result.markedLines).toHaveLength(0);
    expect(result.markedInvoice).toBe('');
  });

  it('does not derive an invoice from Document when the source invoice is blank', () => {
    const vendorLine = rawLine({
      DEBITAMOUNT: 1000,
      INVOICE: '',
      DOCUMENT: 'DOC-ONLY',
      MARKEDINVOICE: '',
    });
    const offsetLine = rawLine({
      CREDITAMOUNT: 1000,
      INVOICE: '',
      DOCUMENT: 'DOC-OFFSET-ONLY',
      MARKEDINVOICE: '',
    });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine }],
      offsetLine,
      vendorGroup: 'Normal',
    });

    expect(result.shouldMark).toBe(false);
    expect(result.markedInvoice).toBe('');
    expect(result.markedLines).toEqual([]);
  });

  it('custody vendor uses DocumentNumber instead of InvoiceNumber', () => {
    const vendorLine = rawLine({
      DEBITAMOUNT: 1000,
      INVOICE: 'CUST-INV',
      DOCUMENT: 'CUST-DOC',
    });
    const offsetLine = rawLine({ CREDITAMOUNT: 1000 });

    const result = resolveVendorPaymentMarking({
      settlements: [{ vendorLine }],
      offsetLine,
      vendorGroup: 'Custody',
    });

    expect(result.shouldMark).toBe(true);
    expect(result.markedLines[0].InvoiceNumber).toBe('');
    expect(result.markedLines[0].DocumentNumber).toBe('CUST-DOC');
  });
});

describe('Vendor Payment Semantic Validation', () => {
  it('passes when invoice exists and belongs to vendor', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-1',
          OperationNumber: '',
          DocumentNumber: 'DOC',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'INV-1',
      documentNum: 'DOC',
      reason: 'test',
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      invoiceLookup: (invoice: string, vendor: string) => ({
        invoice,
        vendorAccount: vendor,
        company: 'm-p',
        exists: true,
        belongsToVendor: true,
        settlementState: 'OPEN',
        isOpen: true,
        currencyCode: 'EGP',
        originalAmount: 1000,
        remainingAmount: 1000,
        lastSettleVoucher: '',
        sourceKey: '1',
      }),
    });

    expect(errors).toHaveLength(0);
  });

  it('fails when invoice does not exist', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-MISSING',
          OperationNumber: '',
          DocumentNumber: 'DOC',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'INV-MISSING',
      documentNum: 'DOC',
      reason: 'test',
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      invoiceLookup: (invoice: string, vendor: string) => ({
        invoice,
        vendorAccount: vendor,
        company: 'm-p',
        exists: false,
        belongsToVendor: false,
        settlementState: 'NOT_FOUND',
        isOpen: null,
        currencyCode: '',
        originalAmount: null,
        remainingAmount: null,
        lastSettleVoucher: '',
        sourceKey: '',
      }),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('was not found');
  });

  it('fails when invoice belongs to another vendor', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-WRONG',
          OperationNumber: '',
          DocumentNumber: 'DOC',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'INV-WRONG',
      documentNum: 'DOC',
      reason: 'test',
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      invoiceLookup: (invoice: string, vendor: string) => ({
        invoice,
        vendorAccount: vendor,
        company: 'm-p',
        exists: true,
        belongsToVendor: false,
        settlementState: 'WRONG_VENDOR',
        isOpen: null,
        currencyCode: 'EGP',
        originalAmount: 1000,
        remainingAmount: 1000,
        lastSettleVoucher: '',
        sourceKey: '1',
      }),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('does not belong');
  });

  it('rejects a marked line whose document number is empty', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-1',
          OperationNumber: '',
          DocumentNumber: '',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'INV-1',
      documentNum: 'TOP-LEVEL-DOC-MUST-NOT-BE-USED',
      reason: 'test',
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      documentNumber: 'TOP-LEVEL-DOC-MUST-NOT-BE-USED',
      invoiceLookup: () => {
        throw new Error('lookup must not run for an incomplete marked line');
      },
    });

    expect(errors).toEqual([
      expect.objectContaining({
        field: 'DocumentNumber',
        message: expect.stringContaining(
          'MarkedLines document number is required',
        ),
      }),
    ]);
  });

  it('verifies every MarkedLines item using its own invoice and document', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-1',
          OperationNumber: '',
          DocumentNumber: 'DOC-1',
          HasWithHoldingLine: false,
        },
        {
          InvoiceNumber: 'INV-2',
          OperationNumber: '',
          DocumentNumber: 'DOC-2',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'TOP-LEVEL-INVOICE-MUST-NOT-BE-USED',
      documentNum: 'TOP-LEVEL-DOC-MUST-NOT-BE-USED',
      reason: 'test',
    });
    const verify = jest.fn().mockReturnValue({
      status: VendorInvoiceMatchStatus.MATCHED,
      matchedTransaction: { isOpen: true },
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      netPaymentAmount: 100,
      currencyCode: 'EGP',
      invoiceLookup: (invoice) =>
        ({
          company: 'm-p',
          invoice,
          vendorAccount: 'VEND-001',
          exists: true,
          belongsToVendor: true,
          candidateTransactions: [],
        }) as any,
      verificationService: { verify } as any,
    });

    expect(errors).toEqual([]);
    expect(verify.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        invoiceNumber: 'INV-1',
        documentNumber: 'DOC-1',
      }),
      expect.objectContaining({
        invoiceNumber: 'INV-2',
        documentNumber: 'DOC-2',
      }),
    ]);
  });

  it('skips lookup check for unmarked result', () => {
    const marking = VendorPaymentMarkingResult.unmarked({
      documentNum: 'DOC',
      reason: 'no invoice',
    });

    const errors = validateVendorPaymentSemantics({
      markingResult: marking,
      vendorAccount: 'VEND-001',
      currencyCode: 'EGP',
      invoiceLookup: () => {
        throw new Error('should not be called');
      },
    });

    expect(errors).toHaveLength(0);
  });
});

describe('Vendor Payment Builder + Director', () => {
  const director = new VendorPaymentDirector();

  const buildContext = (markingResult: VendorPaymentMarkingResult): any => ({
    accountDisplayValue: 'VEND-001',
    accountType: 'Vendor',
    vendorGroup: 'Normal',
    debitAmount: 1000,
    currencyCode: 'EGP',
    exchangeRate: 100,
    reportingCurrencyExchRate: 0,
    transactionDate: '2026-01-15',
    description: 'Vendor Payment - Freight Jan 2026 (Cash)',
    transactionText: 'Vendor Payment - Freight Jan 2026 (Cash)',
    offsetTransactionText: 'Payment ref',
    paymentMethodName: 'Bank',
    paymentReference: 'REF-001',
    offsetAccountDisplayValue: 'BANK-001',
    offsetAccountType: 'Bank',
    offsetCompany: 'm-p',
    journalName: 'P-Freight',
    defaultDimensionDisplayValue: '|dim|string',
    offsetDefaultDimensionDisplayValue: '|dim|string',
    finTagDisplayValue: 'OP-1||',
    offsetFinTagDisplayValue: '',
    salesTaxGroup: 'Non-Taxabl',
    itemSalesTaxGroup: '',
    isWithholdingCalculationEnabled: 'No',
    itemWithholdingTaxGroupCode: '',
    postingProfile: '',
    invoice: 'INV-001',
    documentDate: '2026-01-15',
    dueDate: '2026-02-15',
    voucherType: 'Cash',
    safeType: 'Vendor Payment',
    paymentId: 'VP-001',
    document: 'DOC-001',
    settlementTargetType: 'VendorInvoice',
    markingResult,
  });

  it('constructs valid journal lines for marked payment', () => {
    const marking = VendorPaymentMarkingResult.marked({
      markedLines: [
        {
          InvoiceNumber: 'INV-001',
          OperationNumber: 'OP-1',
          DocumentNumber: '',
          HasWithHoldingLine: false,
        },
      ],
      markedInvoice: 'INV-001',
      documentNum: 'DOC-001',
      reason: 'normal',
    });

    const product = director.construct(
      new VendorPaymentBuilder(),
      buildContext(marking),
    );

    expect(product.vendorLine.accountDisplayValue).toBe('VEND-001');
    expect(product.vendorLine.debitAmount).toBe(1000);
    expect(product.markedInvoice).toBe('INV-001');
    expect(product.markedLines).toHaveLength(1);
    expect(product.markedLines[0].InvoiceNumber).toBe('INV-001');
    expect(product.vendorLine.documentNum).toBe('DOC-001');
  });

  it('constructs valid journal lines for unmarked payment', () => {
    const marking = VendorPaymentMarkingResult.unmarked({
      documentNum: 'DOC-001',
      reason: 'intentionally unmarked',
    });

    const product = director.construct(
      new VendorPaymentBuilder(),
      buildContext(marking),
    );

    expect(product.markedInvoice).toBe('');
    expect(product.markedLines).toHaveLength(0);
    expect(product.markingResult.shouldMark).toBe(false);
  });

  it('throws when builder is missing marking result', () => {
    const builder = new VendorPaymentBuilder();
    builder.setVendorLines(buildContext(undefined as any));

    expect(() => builder.build()).toThrow('markingResult is required');
  });
});

describe('MarkingResult invariant enforcement (regression)', () => {
  it('prevents shouldMark=true with empty markedLines from reaching Product', () => {
    expect(() =>
      VendorPaymentMarkingResult.marked({
        markedLines: [],
        markedInvoice: 'INV-001',
        documentNum: 'DOC',
        reason: 'invariant test',
      }),
    ).toThrow(/invariant violation/);
  });

  it('prevents shouldMark=true with empty markedInvoice from reaching Product', () => {
    expect(() =>
      VendorPaymentMarkingResult.marked({
        markedLines: [
          {
            InvoiceNumber: 'X',
            OperationNumber: '',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
        markedInvoice: '',
        documentNum: 'DOC',
        reason: 'invariant test',
      }),
    ).toThrow(/invariant violation/);
  });
});
