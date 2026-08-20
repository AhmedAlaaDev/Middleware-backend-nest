export interface DataBatchImportJobPayload {
  batchId: string;
  userId: string;
  userName: string;
  userEmail: string;
  correlationId: string;
  voucherNumberSettingLogicalName?: string;
}

export interface DataBatchImportSubmission {
  jobId: string;
  status: 'queued' | 'already-running';
  message: string;
}
