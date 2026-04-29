import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
} from '@/modules/d365fo/types';

export interface PostCustomerPaymentJournalDFOJobPayload {
  batchId: string;
  company: string;
  groupedJournals: Array<{
    header: D365FOCustomerPaymentJournalHeaderRequest;
    lines: D365FOCustomerPaymentJournalLineRequest[];
  }>;
  correlationId?: string;
  sourceModule?: 'CASH';
  cashDirection?: 'in' | 'out';
}
