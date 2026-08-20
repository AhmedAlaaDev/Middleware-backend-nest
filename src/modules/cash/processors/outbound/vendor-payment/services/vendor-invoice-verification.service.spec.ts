import { VendorInvoiceVerificationService } from './vendor-invoice-verification.service';
import {
  VendorCandidateTransaction,
  VendorInvoiceMatchStatus,
  VendorInvoiceVerificationRequest,
} from '../models/vendor-invoice-match-result';

describe('VendorInvoiceVerificationService', () => {
  let service: VendorInvoiceVerificationService;

  beforeEach(() => {
    service = new VendorInvoiceVerificationService();
  });

  const baseCandidates: VendorCandidateTransaction[] = [
    {
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      currencyCode: 'EGP',
      originalAmount: 16823.04,
      openAmount: 16823.04,
      voucher: 'VEND-001',
      sourceKey: 'KEY-001',
      isOpen: true,
    },
    {
      vendorAccount: 'Tr-000032',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      currencyCode: 'EGP',
      originalAmount: 16823.04,
      openAmount: 16823.04,
      voucher: 'VEND-002',
      isOpen: true,
    },
  ];

  it('Case 1: returns VENDOR_NOT_FOUND when vendor does not match candidates', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-999999',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 16455.78,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.VENDOR_NOT_FOUND);
    expect(result.candidateCount.vendor).toBe(0);
    expect(result.reason).toContain('Vendor transaction not found');
  });

  it('Case 2: returns DOCUMENT_NOT_FOUND when vendor matches but document number does not', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-WRONG',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 16455.78,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.DOCUMENT_NOT_FOUND);
    expect(result.candidateCount.vendor).toBe(1);
    expect(result.candidateCount.document).toBe(0);
    expect(result.reason).toContain('document number was not found');
  });

  it('Case 3: returns INVOICE_NOT_FOUND when vendor and document match but invoice does not', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '999 - 2026',
      netPaymentAmount: 16455.78,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.INVOICE_NOT_FOUND);
    expect(result.candidateCount.document).toBe(1);
    expect(result.candidateCount.invoice).toBe(0);
    expect(result.reason).toContain('invoice was not found');
  });

  it('Case 4: returns AMOUNT_NOT_FOUND when vendor, document, and invoice match but amount does not', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 10000.0,
      withholdingAmount: 0,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND);
    expect(result.candidateCount.invoice).toBe(1);
    expect(result.candidateCount.amount).toBe(0);
    expect(result.reason).toContain('amount did not match');
  });

  it('Case 5: returns MATCHED for regression case (Net 16,455.78 + WHT 367.26 = Gross 16,823.04)', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 16455.78,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.MATCHED);
    expect(result.matchedTransaction).toBeDefined();
    expect(result.matchedTransaction?.voucher).toBe('VEND-001');
    expect(result.candidateCount.amount).toBe(1);
  });

  it('Case 6: returns AMBIGUOUS_MATCH when multiple identical candidates remain', () => {
    const duplicateCandidates: VendorCandidateTransaction[] = [
      {
        vendorAccount: 'Tr-000031',
        documentNumber: 'DOC-1001',
        invoiceNumber: '171 - 2026',
        currencyCode: 'EGP',
        originalAmount: 16823.04,
        openAmount: 16823.04,
        voucher: 'VEND-001A',
        isOpen: true,
      },
      {
        vendorAccount: 'Tr-000031',
        documentNumber: 'DOC-1001',
        invoiceNumber: '171 - 2026',
        currencyCode: 'EGP',
        originalAmount: 16823.04,
        openAmount: 16823.04,
        voucher: 'VEND-001B',
        isOpen: true,
      },
    ];

    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 16455.78,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, duplicateCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.AMBIGUOUS_MATCH);
    expect(result.candidateCount.amount).toBe(2);
    expect(result.reason).toContain('Multiple D365 vendor transactions matched');
  });

  it('No WHT payment: correctly verifies standard Net = Invoice amount', () => {
    const candidates: VendorCandidateTransaction[] = [
      {
        vendorAccount: 'Tr-000050',
        documentNumber: 'DOC-5000',
        invoiceNumber: 'INV-5000',
        currencyCode: 'USD',
        originalAmount: 10000.0,
        openAmount: 10000.0,
        voucher: 'VEND-050',
        isOpen: true,
      },
    ];

    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000050',
      documentNumber: 'DOC-5000',
      invoiceNumber: 'INV-5000',
      netPaymentAmount: 10000.0,
      withholdingAmount: 0,
      currencyCode: 'USD',
    };

    const result = service.verify(request, candidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.MATCHED);
    expect(result.matchedTransaction?.voucher).toBe('VEND-050');
  });

  it('Incorrect WHT equation: rejects when Net (16,000) + WHT (367.26) !== Invoice (16,823.04)', () => {
    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-1001',
      invoiceNumber: '171 - 2026',
      netPaymentAmount: 16000.0,
      withholdingAmount: 367.26,
      currencyCode: 'EGP',
    };

    const result = service.verify(request, baseCandidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND);
    expect(result.reason).toContain('Expected settlement: 16367.26');
  });

  it('Partial payment: matches when settlement (8,500) <= openAmount (20,000)', () => {
    const candidates: VendorCandidateTransaction[] = [
      {
        vendorAccount: 'Tr-000031',
        documentNumber: 'DOC-PARTIAL',
        invoiceNumber: 'INV-PARTIAL',
        currencyCode: 'EGP',
        originalAmount: 20000.0,
        openAmount: 20000.0,
        voucher: 'VEND-PARTIAL',
        isOpen: true,
      },
    ];

    const request: VendorInvoiceVerificationRequest = {
      company: 'm-p',
      vendorAccount: 'Tr-000031',
      documentNumber: 'DOC-PARTIAL',
      invoiceNumber: 'INV-PARTIAL',
      netPaymentAmount: 8000.0,
      withholdingAmount: 500.0,
      currencyCode: 'EGP',
      allowPartialPayment: true,
    };

    const result = service.verify(request, candidates);

    expect(result.status).toBe(VendorInvoiceMatchStatus.MATCHED);
    expect(result.matchedTransaction?.voucher).toBe('VEND-PARTIAL');
  });
});
