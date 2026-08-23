export enum VendorInvoiceMatchStatus {
  MATCHED = 'MATCHED',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  DOCUMENT_NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  AMOUNT_NOT_FOUND = 'AMOUNT_NOT_FOUND',
  AMBIGUOUS_MATCH = 'AMBIGUOUS_MATCH',
}

export enum VendorInvoiceMatchStrategy {
  TRANSACTION_ID = 'transaction-id',
  VENDOR_INVOICE_DOCUMENT_AMOUNT = 'vendor-invoice-document-amount',
  VENDOR_INVOICE_DOCUMENT = 'vendor-invoice-document',
  VENDOR_INVOICE_AMOUNT = 'vendor-invoice-amount',
  VENDOR_INVOICE_UNIQUE = 'vendor-invoice-unique',
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
  transactionId?: string;
  recId?: string;
  transactionDate?: string;
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
  /**
   * Vendor Payment source rows can contain a grouped payment total that is not
   * the amount of each marked invoice. In that flow, validate the D365 identity
   * (vendor/document/invoice) and let D365 apply the requested marked lines.
   */
  skipAmountValidation?: boolean;
  transactionId?: string;
}

export interface VendorInvoiceMatchResult {
  status: VendorInvoiceMatchStatus;
  matchedTransaction?: VendorCandidateTransaction;
  matchStrategy?: VendorInvoiceMatchStrategy;
  candidateCount: {
    initial: number;
    vendor: number;
    document: number;
    invoice: number;
    amount: number;
  };
  reason?: string;
  candidateDocuments?: string[];
}
