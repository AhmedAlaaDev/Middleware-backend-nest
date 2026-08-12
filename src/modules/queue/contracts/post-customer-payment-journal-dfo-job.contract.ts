import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
  D365FOVendorInvoiceJournalHeaderRequest,
} from '@/modules/d365fo/types';
import { LedgerJournalHeaderRequest } from '@/modules/d365fo/types/d365fo-ledger.type';
import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';

/** Legacy payload retained so an already-durable pre-2045 job can recover. */
export interface CustomerPaymentJournalPostingGroup {
  header: D365FOCustomerPaymentJournalHeaderRequest;
  lines: D365FOCustomerPaymentJournalLineRequest[];
}

export type CashJournalHeaderRequest =
  | D365FOCustomerPaymentJournalHeaderRequest
  | D365FOVendorInvoiceJournalHeaderRequest
  | LedgerJournalHeaderRequest;

export interface RoutedCashJournalPostingGroup {
  route: CashJournalRoute;
  /** Stable identity persisted with the durable group and stamped into D365FO. */
  integrationMarker?: string;
  header: CashJournalHeaderRequest;
  lines: D365FOCustomerPaymentJournalLineRequest[];
}

export type CashJournalPostingGroup =
  | CustomerPaymentJournalPostingGroup
  | RoutedCashJournalPostingGroup;

export type PostCustomerPaymentJournalDFOJobPayload = DurablePostingJobPayload;
