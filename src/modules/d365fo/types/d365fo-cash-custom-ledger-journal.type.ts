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
  offsetDEFAULTDIMENSIONDISPLAYVALUE: string;

  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  IsWithholdingTaxCalculate?: string;
  ISWITHHOLDINGTAXCALCULATE?: string;
  MARKEDINVOICE?: string | null;
  MarkedLines?: TSLedgerJournalMarkedLine[];
  VendorGroup?: string;

  offsetAccountDisplayValue: string;
  OffsetAccountTypeStr: TSLedgerJournalCustomAccountTypeStr;
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
  DocumentNum: string;
  DocumentDate: string;
  TRANSACTIONTEXT: string;
  Voucher: string;
}

export interface TSLedgerJournalTransCustomRequest {
  _contract: TSLedgerJournalTransCustomRequestBody;
}

export interface TSLedgerJournalTransCustomResponseBody {
  StatusCode: string;
  Message: string;
}
