export interface DataBatchReprocessJobPayload {
  batchId: string;
  userId: string;
  userName: string;
  userEmail: string;
  correlationId: string;
}

export interface DataBatchReprocessSubmission {
  jobId: string;
  status: 'queued' | 'already-running';
  message: string;
}
