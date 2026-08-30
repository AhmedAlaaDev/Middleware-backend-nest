/**
 * D365FO TSLedgerJournalServiceGroup custom endpoints payloads.
 *
 * Endpoints:
 * - addLedgerJournalTransCustPaym
 * - addLedgerJournalTransVendPaym
 *
 * The HTTP wire shape is defined by TSLedgerJournalTransCustomBulkLineRequestBody
 * below. TSLedgerJournalTransCustomRequestBody is retained as the middleware's
 * internal compatibility shape for already queued records.
 */

export type TSLedgerJournalCustomAccountTypeStr =
  | 'Cust'
  | 'Vendor'
  | 'Bank'
  | 'Ledger'
  | 'RCash';

export interface TSLedgerJournalMarkedLine {
  InvoiceNumber: string;
  OperationNumber: string;
  DocumentNumber: string;
  HasWithHoldingLine: boolean;
  /** X++ JournalLineSettlementLine.parmFullSettlement(). */
  FullSettlement?: boolean;
}

export interface TSLedgerJournalTransCustomRequestBody {
  journalNum: string;

  AccountNum: string;
  accountTypeStr: TSLedgerJournalCustomAccountTypeStr;

  BANKTRANSACTIONTYPE: string;
  CENTRALBANKPURPOSECODE: string;
  CENTRALBANKPURPOSETEXT: string;

  company: string;
  creditAmount: number;
  currency: string;
  debitAmount: number;

  ExchRate?: number;
  EXCHANGERATE?: number;
  ExchangeRate?: number;

  ReportingCurrencyExchRate?: number;
  ReportingExchangeRate?: number;
  REPORTINGEXCHANGERATE?: number;

  DEFAULTDIMENSIONDISPLAYVALUE: string;
  offsetDEFAULTDIMENSIONDISPLAYVALUE?: string;

  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  MARKEDINVOICE?: string | null;
  /** Always present; empty means an explicitly unmarked payment. */
  MarkedLines: TSLedgerJournalMarkedLine[];
  VendorGroup?: string;

  offsetAccountDisplayValue?: string;
  OffsetAccountTypeStr?: TSLedgerJournalCustomAccountTypeStr | '';
  OffsetCompany?: string;
  OFFSETFINTAGDISPLAYVALUE?: string;
  OFFSETTRANSACTIONTEXT?: string;

  PAYMENTID: string;
  PAYMENTMETHODNAME: string;
  PAYMENTNOTES: string;
  PAYMENTREFERENCE: string;
  PAYMENTSPECIFICATION: string;

  PostingProfile: string;

  TaxGroup: string;
  TAXITEMGROUP: string;

  transDate: string;
  DocumentNum: string;
  DocumentDate: string;
  TRANSACTIONTEXT: string;
}

export interface TSLedgerJournalTransCustomRequest {
  _contract: TSLedgerJournalTransCustomBulkLineRequestBody;
}

/**
 * Exact wire contract consumed by JournalLineContract::constructFromJsonObject
 * in SDDDFO. Keep this separate from TSLedgerJournalTransCustomRequestBody,
 * which is the middleware's backwards-compatible internal shape.
 */
export interface TSLedgerJournalTransCustomBulkLineRequestBody {
  JournalNum: string;
  AccountNum: string;
  AccountTypeStr: TSLedgerJournalCustomAccountTypeStr | '';
  BANKTRANSACTIONTYPE: string;
  CENTRALBANKPURPOSECODE: string;
  CENTRALBANKPURPOSETEXT: string;
  Company: string;
  CreditAmount: number;
  Currency: string;
  DebitAmount: number;
  DEFAULTDIMENSIONDISPLAYVALUE: string;
  OffsetDEFAULTDIMENSIONDISPLAYVALUE: string;
  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  OffsetAccountDisplayValue: string;
  OffsetAccountTypeStr: TSLedgerJournalCustomAccountTypeStr | '';
  OffsetCompany: string;
  OFFSETFINTAGDISPLAYVALUE: string;
  OFFSETTRANSACTIONTEXT: string;
  PAYMENTID: string;
  PAYMENTMETHODNAME: string;
  PAYMENTNOTES: string;
  PAYMENTREFERENCE: string;
  PAYMENTSPECIFICATION: string;
  PostingProfile: string;
  TaxGroup: string;
  TAXITEMGROUP: string;
  TransDate: string;
  TRANSACTIONTEXT: string;
  DocumentDate: string;
  DocumentNum: string;
  ExchangeRate: number;
  ReportingExchangeRate: number;
  VendorGroup?: string;
  MarkedLines?: Array<{
    InvoiceNumber: string;
    OperationNumber: string;
    DocumentNumber: string;
    HasWithHoldingLine: boolean;
    FullSettlement?: boolean;
  }>;
}

/** Bulk request body: every journal line of the batch (or chunk) in `Lines`. */
export interface TSLedgerJournalTransCustomBulkRequestBody {
  Lines: TSLedgerJournalTransCustomBulkLineRequestBody[];
}

export interface TSLedgerJournalTransCustomBulkRequest {
  _contract: TSLedgerJournalTransCustomBulkRequestBody;
}

export interface TSLedgerJournalTransCustomResponseBody {
  StatusCode: string;
  Message: string;
}

/**
 * Optional per-line result. Live `TSAddLedgerJournalResponse` only returns
 * overall StatusCode/Message (one TTS for the whole Lines array); these fields
 * are kept for defensive parsing if FO adds line results later.
 */
export interface TSLedgerJournalTransCustomBulkLineResponseBody {
  LineNumber?: number;
  lineNumber?: number;
  StatusCode?: string;
  statusCode?: string;
  Message?: string;
  message?: string;
  Success?: boolean;
  success?: boolean;
  ErrorMessage?: string;
  errorMessage?: string;
  ExceptionMessage?: string;
  exceptionMessage?: string;
  Details?: unknown;
  details?: unknown;
  Error?: unknown;
  error?: unknown;
}

/**
 * Bulk response. Primary contract is overall StatusCode + Message (all lines
 * commit or roll back together). Optional line arrays are defensive only.
 */
export interface TSLedgerJournalTransCustomBulkResponseBody {
  StatusCode?: string;
  statusCode?: string;
  Message?: string;
  message?: string;
  Lines?: TSLedgerJournalTransCustomBulkLineResponseBody[];
  lines?: TSLedgerJournalTransCustomBulkLineResponseBody[];
  Results?: TSLedgerJournalTransCustomBulkLineResponseBody[];
  results?: TSLedgerJournalTransCustomBulkLineResponseBody[];
  ErrorMessage?: string;
  errorMessage?: string;
  ExceptionMessage?: string;
  exceptionMessage?: string;
  Details?: unknown;
  details?: unknown;
  Error?: unknown;
  error?: unknown;
}
