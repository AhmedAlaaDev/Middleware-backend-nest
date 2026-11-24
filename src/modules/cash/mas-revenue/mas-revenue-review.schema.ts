import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import type { MasRevenueStoredRaw } from './mas-revenue-stored';

/**
 *   PREVIEWED        normalized snapshot stored; submit allowed if it can submit
 *   SUBMITTING       a submit owns the review (batch creation in progress)
 *   BATCH_CREATED    the Cash In batch exists; posting is sent separately (PostToDFO)
 *   SUBMIT_FAILED    batch creation failed before a batch existed; submit may be retried
 */
export const MAS_REVENUE_REVIEW_STATUSES = [
  'PREVIEWED',
  'SUBMITTING',
  'BATCH_CREATED',
  'SUBMIT_FAILED',
] as const;

export type MasRevenueReviewStatus =
  (typeof MAS_REVENUE_REVIEW_STATUSES)[number];

export type MasRevenueReviewDocument = HydratedDocument<MasRevenueReview>;

@Schema({
  collection: 'mas_revenue_reviews',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class MasRevenueReview {
  @Prop({ required: true })
  company: string;

  @Prop({ required: true })
  createdByUserId: string;

  @Prop()
  fileName: string;

  @Prop({ required: true, type: Number })
  templateVersion: number;

  @Prop({
    type: String,
    required: true,
    enum: MAS_REVENUE_REVIEW_STATUSES,
    default: 'PREVIEWED',
  })
  status: MasRevenueReviewStatus;

  /** Hash of the normalized receipts, currency and template version. */
  @Prop({ required: true })
  payloadHash: string;

  /** Counts, totals, sheet facts and a bounded list of row issues. */
  @Prop({ type: Object })
  summary?: Record<string, unknown>;

  /** True only when the file has no row issues and at least one receipt. */
  @Prop({ type: Boolean, default: false })
  canSubmit: boolean;

  @Prop({ type: Number, default: 0 })
  receiptCount: number;

  /** Set once, when the submit creates the batch. */
  @Prop()
  batchId?: string;

  /** Idempotency key of the submit that created the batch. */
  @Prop()
  submitKey?: string;

  @Prop()
  lastError?: string;

  @Prop()
  submittedAt?: Date;

  @Prop({ required: true })
  correlationId: string;
}

export const MasRevenueReviewSchema =
  SchemaFactory.createForClass(MasRevenueReview);
MasRevenueReviewSchema.index({
  company: 1,
  createdByUserId: 1,
  created_at: -1,
});

/** One accepted receipt of a review, stored as the immutable snapshot. */
@Schema({
  collection: 'mas_revenue_review_lines',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class MasRevenueReviewLine {
  @Prop({ required: true })
  reviewId: string;

  @Prop({ required: true })
  company: string;

  @Prop({ required: true, type: Number })
  position: number;

  @Prop({ required: true })
  invoiceNumber: string;

  @Prop({ required: true })
  transactionDate: string;

  /** Empty when the receipt cash account could not be resolved; submit is then blocked. */
  @Prop({ type: String, default: '' })
  currency: string;

  @Prop({ type: Object, required: true })
  raw: MasRevenueStoredRaw;

  /** Set when the review that holds this receipt created a batch. Used to block re-submission. */
  @Prop()
  batchId?: string;
}

export type MasRevenueReviewLineDocument =
  HydratedDocument<MasRevenueReviewLine>;

export const MasRevenueReviewLineSchema =
  SchemaFactory.createForClass(MasRevenueReviewLine);
MasRevenueReviewLineSchema.index({ reviewId: 1, position: 1 });
MasRevenueReviewLineSchema.index({ company: 1, invoiceNumber: 1, batchId: 1 });

/**
 * One claim per accepted receipt identity (version 2). The unique indexes are the
 * database-level guard: two submits of the same receipt cannot both insert a claim,
 * and two identities cannot share a PaymentId base. A claim exists from the moment a
 * submit reserves the receipt until its batch is created or the submit fails.
 */
@Schema({
  collection: 'mas_revenue_receipt_claims',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class MasRevenueReceiptClaim {
  @Prop({ required: true })
  company: string;

  /** Canonical identity key (company, namespace, year, invoice). */
  @Prop({ required: true })
  identityKey: string;

  /** PaymentId base (MR<year>-<hash>). Unique per company. */
  @Prop({ required: true })
  paymentIdBase: string;

  @Prop({ required: true })
  invoiceNumber: string;

  @Prop({ required: true, type: Number })
  year: number;

  @Prop({ required: true })
  fingerprint: string;

  @Prop({ required: true })
  reviewId: string;

  /** Set once the submit has created the batch. */
  @Prop()
  batchId?: string;
}

export type MasRevenueReceiptClaimDocument =
  HydratedDocument<MasRevenueReceiptClaim>;

export const MasRevenueReceiptClaimSchema = SchemaFactory.createForClass(
  MasRevenueReceiptClaim,
);
MasRevenueReceiptClaimSchema.index(
  { company: 1, identityKey: 1 },
  { unique: true, name: 'uniq_company_identity' },
);
MasRevenueReceiptClaimSchema.index(
  { company: 1, paymentIdBase: 1 },
  { unique: true, name: 'uniq_company_payment_id_base' },
);
MasRevenueReceiptClaimSchema.index({ company: 1, invoiceNumber: 1 });
MasRevenueReceiptClaimSchema.index({ reviewId: 1 });
