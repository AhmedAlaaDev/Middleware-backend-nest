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
  | 'Petty Cash';

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

  DEFAULTDIMENSIONDISPLAYVALUE: string;
  offsetDEFAULTDIMENSIONDISPLAYVALUE: string;

  EXCHANGERATE: number;

  FinTagStr: string;
  ISPREPAYMENT: string;
  ITEMWITHHOLDINGTAXGROUP: string;
  MARKEDINVOICE: string;

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
  TRANSACTIONTEXT: string;
  Voucher: string;
}

export interface TSLedgerJournalTransCustomResponseBody {
  StatusCode: string;
  Message: string;
}
