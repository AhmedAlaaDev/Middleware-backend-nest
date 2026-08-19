import { processVendorPaymentGroup } from './vendor-payment.processor';

function rawLine(overrides: Record<string, any> = {}): any {
  return {
    LINENUMBER: 1,
    UniqueId: 1,
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    ACCOUNTTYPE: 'Vendor',
    ACCOUNTDISPLAYVALUE: 'VEND-001',
    DEFAULTDIMENSIONDISPLAYVALUE: '|dim|values',
    CURRENCYCODE: 'EGP',
    TRANSDATE: '2026-01-15',
    DOCUMENT: 'DOC-001',
    INVOICE: 'INV-001',
    MARKEDINVOICE: '',
    FINTAGDISPLAYVALUE: 'OP-1||',
    ISWITHHOLDINGCALCULATIONENABLED: '',
    ITEMWITHHOLDINGTAXGROUPCODE: '',
    DESCRIPTION: 'Test',
    VoucherType: 'Cash',
    SafeType: 'Vendor Payment',
    VendorGroup: 'Normal',
    IsVendor: true,
    IsVendorPayment: true,
    IsCustodyVendor: false,
    PAYMENTMETHOD: '',
    PAYMENTREFERENCE: '',
    POSTINGPROFILE: '',
    DOCUMENTDATE: '2026-01-15',
    DUEDATE: '2026-02-15',
    SALESTAXGROUP: 'Non-Taxabl',
    ITEMSALESTAXGROUP: '',
    OFFSETFINTAGDISPLAYVALUE: '',
    ...overrides,
  };
}

const defaultDeps: any = {
  company: 'm-p',
  isTrucking: false,
  invoiceLookup: (invoice: string, vendor: string) => ({
    invoice,
    vendorAccount: vendor,
    company: 'm-p',
    exists: true,
    belongsToVendor: true,
    settlementState: 'OPEN',
    isOpen: true,
    currencyCode: invoice === 'DOC-X' ? 'USD' : 'EGP',
    originalAmount: 1000,
    remainingAmount: 1000,
    lastSettleVoucher: '',
    sourceKey: '1',
  }),
  resolveExchangeRate: () => ({ exchangeRate: 100, reportingRate: 0 }),
  resolveDimensions: () => '|dim|values',
  resolveJournalName: () => 'P-Freight',
  replaceFinTagShippingLine: (v: string) => v,
  formatMonthYear: () => 'Jan 2026',
  getCashCollectionDescriptionLabel: () => 'Freight',
};

describe('VendorPaymentProcessor (processVendorPaymentGroup)', () => {
  describe('normal marked vendor payment', () => {
    it('produces marked result with correct fields', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 1000 }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-1', lines, defaultDeps);

      expect(result.errors).toHaveLength(0);
      expect(result.lines).toHaveLength(1);

      const product = result.lines[0];
      expect(product.markingResult.shouldMark).toBe(true);
      expect(product.markedInvoice).toBe('INV-001');
      expect(product.markedLines).toHaveLength(1);
      expect(product.markedLines[0].InvoiceNumber).toBe('INV-001');
      expect(product.markedLines[0].OperationNumber).toBe('OP-1');
      expect(product.markedLines[0].HasWithHoldingLine).toBe(false);
      expect(product.vendorLine.accountDisplayValue).toBe('VEND-001');
      expect(product.vendorLine.vendorGroup).toBe('Normal');
      expect(product.vendorLine.debitAmount).toBe(1000);
      expect(product.vendorLine.currencyCode).toBe('EGP');
      expect(product.vendorLine.journalName).toBe('P-Freight');
      expect(product.vendorLine.safeType).toBe('Vendor Payment');
    });
  });

  describe('vendor payment with withholding', () => {
    it('sets HasWithHoldingLine when 223304 credit matches by invoice', () => {
      const lines = [
        rawLine({
          DEBITAMOUNT: 1000,
          ITEMWITHHOLDINGTAXGROUPCODE: 'WHT-1',
          INVOICE: 'INV-001',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 50,
          IsVendor: false,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|dims',
          INVOICE: 'INV-001',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 950,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-2', lines, defaultDeps);

      expect(result.errors).toHaveLength(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].markedLines[0].HasWithHoldingLine).toBe(true);
      expect(result.lines[0].vendorLine.isWithholdingCalculationEnabled).toBe(
        'Yes',
      );
      expect(result.lines[0].vendorLine.itemWithholdingTaxGroupCode).toBe(
        'WHT-1',
      );
    });

    it('sets HasWithHoldingLine when 223304 credit matches by document+currency+operation', () => {
      const lines = [
        rawLine({
          DEBITAMOUNT: 1000,
          ITEMWITHHOLDINGTAXGROUPCODE: 'WHT-2',
          INVOICE: '',
          DOCUMENT: 'DOC-X',
          CURRENCYCODE: 'USD',
          FINTAGDISPLAYVALUE: 'OP-5||',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 50,
          IsVendor: false,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|dims',
          INVOICE: '',
          DOCUMENT: 'DOC-X',
          CURRENCYCODE: 'USD',
          FINTAGDISPLAYVALUE: 'OP-5||',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 950,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-2b', lines, defaultDeps);

      expect(result.errors).toHaveLength(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].markedLines[0].HasWithHoldingLine).toBe(true);
      expect(result.lines[0].markedLines[0].OperationNumber).toBe('OP-5');
    });

    it('does NOT set HasWithHoldingLine when no 223304 line matches', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 1000, INVOICE: 'INV-001' }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-2c', lines, defaultDeps);

      expect(result.lines[0].markedLines[0].HasWithHoldingLine).toBe(false);
      expect(result.lines[0].vendorLine.isWithholdingCalculationEnabled).toBe(
        'No',
      );
    });
  });

  describe('UniqueId 500407 regression', () => {
    it('preserves gross vendor amount, withholding flag, and marked invoice 171', () => {
      const lines = [
        rawLine({
          UniqueId: 500407,
          LINENUMBER: 10,
          ACCOUNTDISPLAYVALUE: 'Tr-000031',
          DEBITAMOUNT: 16823.04,
          CREDITAMOUNT: 0,
          INVOICE: '171',
          DOCUMENT: '19307',
          FINTAGDISPLAYVALUE: 'O26-EXP-OC-2143||',
          ITEMWITHHOLDINGTAXGROUPCODE: 'WHT',
        }),
        rawLine({
          UniqueId: 500407,
          LINENUMBER: 11,
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 367.26,
          IsVendor: false,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|dims',
          INVOICE: '171',
          DOCUMENT: '19307',
          FINTAGDISPLAYVALUE: 'O26-EXP-OC-2143||',
        }),
        rawLine({
          UniqueId: 500407,
          LINENUMBER: 12,
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 16455.78,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('500407', lines, defaultDeps);

      expect(result.errors).toHaveLength(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].vendorLine.debitAmount).toBeCloseTo(16823.04);
      expect(result.lines[0].markedInvoice).toBe('171');
      expect(result.lines[0].markedLines).toEqual([
        expect.objectContaining({
          InvoiceNumber: '171',
          DocumentNumber: '19307',
          OperationNumber: 'O26-EXP-OC-2143',
          HasWithHoldingLine: true,
        }),
      ]);
    });
  });

  describe('intentionally unmarked payment', () => {
    it('produces unmarked result when no invoice', () => {
      const lines = [
        rawLine({
          DEBITAMOUNT: 1000,
          INVOICE: '',
          DOCUMENT: '',
          MARKEDINVOICE: '',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          INVOICE: '',
          DOCUMENT: '',
          MARKEDINVOICE: '',
        }),
      ];

      const result = processVendorPaymentGroup('VP-3', lines, defaultDeps);

      expect(result.errors).toHaveLength(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].markingResult.shouldMark).toBe(false);
      expect(result.lines[0].markedInvoice).toBe('');
      expect(result.lines[0].markedLines).toHaveLength(0);
      expect(result.lines[0].vendorLine.description).toContain('unmarked');
    });
  });

  describe('invoice not found in D365', () => {
    it('returns semantic error', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 1000 }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const deps = {
        ...defaultDeps,
        invoiceLookup: (invoice: string, vendor: string) => ({
          ...defaultDeps.invoiceLookup(invoice, vendor),
          exists: false,
          belongsToVendor: false,
          settlementState: 'NOT_FOUND',
          isOpen: null,
        }),
      };

      const result = processVendorPaymentGroup('VP-4', lines, deps);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('was not found');
    });
  });

  describe('invoice belongs to another vendor', () => {
    it('returns semantic error', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 1000 }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const deps = {
        ...defaultDeps,
        invoiceLookup: (invoice: string, vendor: string) => ({
          ...defaultDeps.invoiceLookup(invoice, vendor),
          belongsToVendor: false,
          settlementState: 'WRONG_VENDOR',
        }),
      };

      const result = processVendorPaymentGroup('VP-5', lines, deps);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('does not belong');
    });
  });

  describe('invoice already settled', () => {
    it('returns semantic error for a closed invoice snapshot', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 1000 }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const deps = {
        ...defaultDeps,
        invoiceLookup: (invoice: string, vendor: string) => ({
          ...defaultDeps.invoiceLookup(invoice, vendor),
          settlementState: 'CLOSED',
          isOpen: false,
          remainingAmount: 0,
        }),
      };

      const result = processVendorPaymentGroup('VP-5b', lines, deps);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('already closed/settled');
    });
  });

  describe('structural validation failures', () => {
    it('fails with no vendor debit lines', () => {
      const lines = [
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-6', lines, defaultDeps);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.lines).toHaveLength(0);
    });
  });

  describe('multiple vendor lines in one group', () => {
    it('sums debit amounts correctly', () => {
      const lines = [
        rawLine({ DEBITAMOUNT: 400, LINENUMBER: 1 }),
        rawLine({ DEBITAMOUNT: 600, LINENUMBER: 2 }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-7', lines, defaultDeps);

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].vendorLine.debitAmount).toBe(1000);
      expect(result.lines[0].markedLines).toHaveLength(2);
    });
  });

  describe('custody vendor', () => {
    it('uses DocumentNumber and empty InvoiceNumber', () => {
      const lines = [
        rawLine({
          DEBITAMOUNT: 1000,
          VendorGroup: 'Custody',
          IsCustodyVendor: true,
          DOCUMENT: 'CUST-DOC',
        }),
        rawLine({
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          IsVendor: false,
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
        }),
      ];

      const result = processVendorPaymentGroup('VP-8', lines, {
        ...defaultDeps,
        invoiceLookup: (invoice: string, vendor: string) => ({
          ...defaultDeps.invoiceLookup(invoice, vendor),
          exists: true,
          belongsToVendor: true,
        }),
      });

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].markedLines[0].InvoiceNumber).toBe('');
      expect(result.lines[0].markedLines[0].DocumentNumber).toBe('CUST-DOC');
      expect(result.lines[0].vendorLine.settlementTargetType).toBe(
        'CustodyLedger',
      );
    });
  });
});
