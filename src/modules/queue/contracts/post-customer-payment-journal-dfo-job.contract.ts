import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';

export interface CustomerPaymentJournalPostingGroup {
  header: D365FOCustomerPaymentJournalHeaderRequest;
  lines: D365FOCustomerPaymentJournalLineRequest[];
}

export type PostCustomerPaymentJournalDFOJobPayload = DurablePostingJobPayload;
