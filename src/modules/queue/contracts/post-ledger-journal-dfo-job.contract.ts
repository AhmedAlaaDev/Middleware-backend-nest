import {
  LedgerJournalHeaderRequest,
  LedgerJournalLineRequest,
} from '@/modules/d365fo/types/d365fo-ledger.type';
import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';

export interface LedgerJournalPostingGroup {
  header: LedgerJournalHeaderRequest;
  lines: LedgerJournalLineRequest[];
}

export type PostLedgerJournalDFOJobPayload = DurablePostingJobPayload;
