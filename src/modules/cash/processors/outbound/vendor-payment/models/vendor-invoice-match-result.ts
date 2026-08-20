export enum VendorInvoiceMatchStatus {
  MATCHED = 'MATCHED',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  DOCUMENT_NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  AMOUNT_NOT_FOUND = 'AMOUNT_NOT_FOUND',
  AMBIGUOUS_MATCH = 'AMBIGUOUS_MATCH',
}

export interface VendorPaymentAmounts {
  grossInvoiceAmount: number;
  netPaymentAmount: number;
  withholdingAmount: number;
  settlementAmount: number;
}

export interface VendorCandidateTransaction {
  vendorAccount: string;
  documentNumber: string;
  invoiceNumber: string;
  currencyCode: string;
  originalAmount: number;
  openAmount: number;
  voucher?: string;
  sourceKey?: string;
  isOpen?: boolean;
  transDate?: string;
  lastSettleVoucher?: string;
}

export interface VendorInvoiceVerificationRequest {
  company: string;
  vendorAccount: string;
  documentNumber: string;
  invoiceNumber: string;
  grossInvoiceAmount?: number;
  netPaymentAmount: number;
  withholdingAmount: number;
  currencyCode: string;
  allowPartialPayment?: boolean;
}

export interface VendorInvoiceMatchResult {
  status: VendorInvoiceMatchStatus;
  matchedTransaction?: VendorCandidateTransaction;
  candidateCount: {
    initial: number;
    vendor: number;
    document: number;
    invoice: number;
    amount: number;
  };
  reason?: string;
}
