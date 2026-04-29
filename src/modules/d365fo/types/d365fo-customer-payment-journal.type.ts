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
   * Used by cash posting pipeline to route cash-in/out line posting to the
   * correct custom ledger journal transaction API.
   */
  cashDirection: 'in' | 'out';

  /**
   * Strict request body for cash custom line APIs.
   * IMPORTANT: This must be built in the cash module handler (not in the service).
   */
  customLineApiBody: TSLedgerJournalTransCustomRequestBody;
}
