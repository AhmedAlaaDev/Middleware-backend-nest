import {
  LedgerJournalHeaderRequest,
  LedgerJournalLineRequest,
} from '@/modules/d365fo/types/d365fo-ledger.type';

export interface PostLedgerJournalDFOJobPayload {
  batchId: string;
  company: string;
  groupedJournals: Array<{
    header: LedgerJournalHeaderRequest;
    lines: LedgerJournalLineRequest[];
  }>;
  sourceModule?: 'Ledger';
}
