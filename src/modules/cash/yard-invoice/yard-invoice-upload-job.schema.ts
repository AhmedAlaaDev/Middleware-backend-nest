import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Durable state of one Yard invoice upload.
 *   REVIEWING     background review running
 *   REVIEW_FAILED review could not complete; re-upload to review again
 *   PREVIEWED     review complete; may be submitted if the summary says so
 *   SUBMITTING    a submit owns the job (re-review, batch creation)
 *   BATCH_CREATED batch exists, queueing not confirmed
 *   QUEUED        durable posting job created
 *   SUBMIT_FAILED batch exists, queueing failed (retry re-queues the same batch)
 */
export const YARD_INVOICE_JOB_STATUSES = [
  'REVIEWING',
  'REVIEW_FAILED',
  'PREVIEWED',
  'SUBMITTING',
  'BATCH_CREATED',
  'QUEUED',
  'SUBMIT_FAILED',
] as const;

export type YardInvoiceJobStatus = (typeof YARD_INVOICE_JOB_STATUSES)[number];

export type YardInvoiceUploadJobDocument =
  HydratedDocument<YardInvoiceUploadJob>;

@Schema({
  collection: 'yard_invoice_upload_jobs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class YardInvoiceUploadJob {
  @Prop({ required: true })
  company: string;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop()
  fileName: string;

  /** Invoice review flow that created the job: YARD (default) or SHIPLINK. */
  @Prop({ type: String, enum: ['YARD', 'SHIPLINK'], default: 'YARD' })
  flow?: 'YARD' | 'SHIPLINK';

  /** Upload format detected by the review: TEMPLATE_8 or YARDS_SOURCE. */
  @Prop()
  format?: string;

  @Prop()
  payloadHash?: string;

  @Prop({
    type: String,
    required: true,
    enum: YARD_INVOICE_JOB_STATUSES,
    default: 'REVIEWING',
  })
  status: YardInvoiceJobStatus;

  /** Review summary (counts, totals, issues, sheets). Bounded size. */
  @Prop({ type: Object })
  summary?: Record<string, unknown>;

  @Prop({ type: Number, default: 0 })
  invoiceCount: number;

  @Prop({ type: Boolean, default: false })
  canSubmit: boolean;

  /** Set once, when the single Yard batch for this job is created. */
  @Prop()
  batchId?: string;

  /** Durable posting job reference returned by the existing posting queue. */
  @Prop()
  postingJobId?: string;

  @Prop()
  submissionStatus?: string;

  @Prop()
  lastError?: string;

  @Prop()
  correlationId: string;

  @Prop()
  submittedAt?: Date;
}

export const YardInvoiceUploadJobSchema =
  SchemaFactory.createForClass(YardInvoiceUploadJob);
YardInvoiceUploadJobSchema.index({
  company: 1,
  createdByUserId: 1,
  created_at: -1,
});
YardInvoiceUploadJobSchema.index(
  { batchId: 1 },
  { sparse: true, unique: true },
);

/** One reviewed invoice of a job, stored for paged display and audit. */
@Schema({
  collection: 'yard_invoice_review_lines',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class YardInvoiceReviewLineDoc {
  @Prop({ required: true })
  jobId: string;

  @Prop({ required: true, type: Number })
  position: number;

  @Prop({ required: true })
  invoiceNumber: string;

  @Prop({ type: Object, required: true })
  line: Record<string, unknown>;
}

export const YardInvoiceReviewLineSchema = SchemaFactory.createForClass(
  YardInvoiceReviewLineDoc,
);
YardInvoiceReviewLineSchema.index({ jobId: 1, position: 1 }, { unique: true });
