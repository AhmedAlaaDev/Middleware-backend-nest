export interface DurablePostingJobPayload {
  batchId: string;
  company: string;
  correlationId: string;
  sourceModule: 'AR' | 'VENDOR' | 'CASH' | 'Ledger';
  payloadVersion: 1;
  journalKind?: 'invoice' | 'payment';
  cashDirection?: 'in' | 'out';
}

export type DurableJobSubmissionStatus =
  | 'queued'
  | 'requeued'
  | 'already-running'
  | 'already-completed';

export interface DurablePostingSubmissionResult {
  jobId: string;
  message: string;
  submissionStatus: DurableJobSubmissionStatus;
}
