/**
 * D365FO TSLedgerJournalServiceGroup custom endpoints payloads.
 *
 * Endpoints:
 * - addLedgerJournalTransCustPaym
 * - addLedgerJournalTransVendPaym
 *
 * These endpoints expect strict parameter names (case-sensitive).
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
  ExchRateSecond?: number;

  DEFAULTDIMENSIONDISPLAYVALUE: string;
  offsetDEFAULTDIMENSIONDISPLAYVALUE?: string;

  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  IsWithholdingTaxCalculate?: string;
  ISWITHHOLDINGTAXCALCULATE?: string;
  MARKEDINVOICE?: string | null;
  MarkedLines?: TSLedgerJournalMarkedLine[];
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
  Voucher: string;
}

export interface TSLedgerJournalTransCustomRequest {
  _contract: TSLedgerJournalTransCustomRequestBody;
}

/**
 * One entry of the Cash Out `_contract.Lines` collection
 * (`addLedgerJournalTransVendPaym` / JournalLineWrapper).
 *
 * Matches the FO Cash Out bulk contract: one clean field set per line (no
 * duplicate ExchRate / EXCHANGERATE / ReportingCurrencyExchRate aliases).
 * Offset display values use the documented lowercase keys; other Offset*
 * members and VendorGroup stay present (empty when unused) because FO's
 * `constructFromJsonObject` looks them up without `exists()`.
 */
export interface TSLedgerJournalTransCustomBulkLineRequestBody {
  journalNum: string;
  AccountNum: string;
  accountTypeStr: Lowercase<TSLedgerJournalCustomAccountTypeStr> | '';
  BANKTRANSACTIONTYPE: string;
  CENTRALBANKPURPOSECODE: string;
  CENTRALBANKPURPOSETEXT: string;
  company: string;
  creditAmount: number;
  currency: string;
  debitAmount: number;
  DEFAULTDIMENSIONDISPLAYVALUE: string;
  offsetDEFAULTDIMENSIONDISPLAYVALUE: string;
  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  MarkedLines?: TSLedgerJournalMarkedLine[];
  offsetAccountDisplayValue: string;
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
  transDate: string;
  TRANSACTIONTEXT: string;
  DocumentNum: string;
  DocumentDate: string;
  ReportingExchangeRate: number;
  VendorGroup: string;
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
