import { TSLedgerJournalTransCustomRequestBody } from './d365fo-cash-custom-ledger-journal.type';

/**
 * Request data for posting a customer payment journal header to D365FO.
 * Shape intentionally mirrors vendor payment journal headers:
 * dataAreaId, JournalBatchNumber, JournalName, Description.
 */
export interface D365FOCustomerPaymentJournalHeaderRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

/**
 * Response data from posting a customer payment journal header to D365FO.
 */
export interface D365FOCustomerPaymentJournalHeaderResponse {
  '@odata.context'?: string;
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

export interface D365FOCustomerPaymentJournalLineRequest {
  dataAreaId: string;
  LineNumber: number;
  /**
   * Excel LINENUMBER from the source workbook. Cash-out reindexes LineNumber
   * for D365, so this is the identity used in skip/error Excel reports.
   */
  sourceLineNumber?: number;
  /**
   * Used by cash posting pipeline to route cash-in/out line posting to the
   * correct custom ledger journal transaction API.
   */
  cashDirection: 'in' | 'out';

  /**
   * Strict request body for cash custom line APIs.
   * IMPORTANT: This must be built in the cash module handler (not in the service).
   */
  customLineApiBody: TSLedgerJournalTransCustomRequestBody;
  /**
   * Source invoice used to keep Custody Settlement UniqueIds that contain
   * several invoices in separate X++ requests. Not sent to Finance.
   */
  groupInvoice?: string;
  /**
   * After the Cash-In journal line exists, settle this invoice for this line's
   * credit amount via PaymentJournalLineSettledInvoices. Not sent to X++.
   */
  customerSettlement?: {
    invoiceNumber: string;
    settlementAmount: number;
    customerAccount: string;
    /** Payment amount is denominated in customLineApiBody.currency. */
    paymentCurrency?: string;
    /** D365 exchange rate field is scaled by 100 (for example 4875 = 48.75). */
    paymentExchangeRate?: number;
  };
}
