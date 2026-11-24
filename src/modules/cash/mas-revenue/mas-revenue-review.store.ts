import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';

import {
  MasRevenueReceiptClaim,
  MasRevenueReceiptClaimDocument,
  MasRevenueReview,
  MasRevenueReviewDocument,
  MasRevenueReviewLine,
  MasRevenueReviewLineDocument,
  MasRevenueReviewStatus,
} from './mas-revenue-review.schema';

import type { MasRevenueStoredRaw } from './mas-revenue-stored';

export interface MasRevenueReviewRecord {
  id: string;
  company: string;
  createdByUserId: string;
  fileName: string;
  templateVersion: number;
  transactionCurrency: string;
  status: MasRevenueReviewStatus;
  payloadHash: string;
  summary: Record<string, unknown> | null;
  canSubmit: boolean;
  receiptCount: number;
  batchId: string | null;
  submitKey: string | null;
  lastError: string | null;
  submittedAt: Date | null;
  correlationId: string;
  createdAt: Date;
}

export interface MasRevenueReviewLineRecord {
  reviewId: string;
  company: string;
  position: number;
  invoiceNumber: string;
  transactionDate: string;
  currency: string;
  raw: MasRevenueStoredRaw;
  batchId: string | null;
}

export interface MasRevenueReceiptClaimRecord {
  company: string;
  identityKey: string;
  paymentIdBase: string;
  invoiceNumber: string;
  year: number;
  fingerprint: string;
  reviewId: string;
  batchId: string | null;
}

export type NewMasRevenueReview = Omit<
  MasRevenueReviewRecord,
  | 'id'
  | 'createdAt'
  | 'batchId'
  | 'submitKey'
  | 'lastError'
  | 'submittedAt'
  | 'status'
>;

export type NewMasRevenueReceiptClaim = Omit<
  MasRevenueReceiptClaimRecord,
  'reviewId' | 'batchId'
>;

export type MasRevenueClaimResult =
  | { ok: true }
  | { ok: false; reason: 'IDENTITY_TAKEN' | 'PAYMENT_ID_TAKEN' };

/**
 * Durable state of MAS revenue reviews. The service depends on this contract, so
 * tests can use an in-memory fake and production uses MongoDB.
 */
export abstract class MasRevenueReviewStore {
  abstract createReview(
    review: NewMasRevenueReview,
  ): Promise<MasRevenueReviewRecord>;
  abstract insertLines(lines: MasRevenueReviewLineRecord[]): Promise<void>;
  abstract findReview(id: string): Promise<MasRevenueReviewRecord | null>;
  abstract updateReview(
    id: string,
    patch: Partial<MasRevenueReviewRecord>,
  ): Promise<void>;
  /** Atomically moves the review from one of `from` to `to`. Returns null when the state did not match. */
  abstract claimReview(
    id: string,
    from: MasRevenueReviewStatus[],
    to: MasRevenueReviewStatus,
    submitKey: string | null,
  ): Promise<MasRevenueReviewRecord | null>;
  abstract findLines(reviewId: string): Promise<MasRevenueReviewLineRecord[]>;
  abstract pageLines(
    reviewId: string,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; items: MasRevenueReviewLineRecord[] }>;
  /** Submitted (batch-holding) lines of this company for the given invoice numbers, any year. */
  abstract findSubmittedReceiptLines(
    company: string,
    invoiceNumbers: string[],
  ): Promise<MasRevenueReviewLineRecord[]>;
  /** Identity claims of this company for the given invoice numbers, any year. */
  abstract findReceiptClaims(
    company: string,
    invoiceNumbers: string[],
  ): Promise<MasRevenueReceiptClaimRecord[]>;
  /**
   * Reserves every receipt identity for one review, all or nothing. Enforced by the
   * unique indexes: a claim for a receipt that already exists is refused. A refused
   * call leaves no claim of this review behind.
   */
  abstract claimReceiptIdentities(
    reviewId: string,
    claims: NewMasRevenueReceiptClaim[],
  ): Promise<MasRevenueClaimResult>;
  /** Removes this review's claims that have no batch. Used when a submit fails before its batch exists. */
  abstract releaseUnbatchedReceiptClaims(reviewId: string): Promise<void>;
  /** Attaches the created batch to this review's claims. */
  abstract attachBatchToReceiptClaims(
    reviewId: string,
    batchId: string,
  ): Promise<void>;
  abstract markLinesSubmitted(reviewId: string, batchId: string): Promise<void>;
}

@Injectable()
export class MongoMasRevenueReviewStore extends MasRevenueReviewStore {
  constructor(
    @InjectModel(MasRevenueReview.name)
    private readonly reviews: Model<MasRevenueReviewDocument>,
    @InjectModel(MasRevenueReviewLine.name)
    private readonly lines: Model<MasRevenueReviewLineDocument>,
    @InjectModel(MasRevenueReceiptClaim.name)
    private readonly claims: Model<MasRevenueReceiptClaimDocument>,
  ) {
    super();
  }

  public async createReview(
    review: NewMasRevenueReview,
  ): Promise<MasRevenueReviewRecord> {
    const doc = new this.reviews({
      ...review,
      status: 'PREVIEWED',
      batchId: null,
      submitKey: null,
      lastError: null,
      submittedAt: null,
    });
    await doc.save();
    return toReviewRecord(doc.toObject() as unknown as ReviewLean);
  }

  public async insertLines(lines: MasRevenueReviewLineRecord[]): Promise<void> {
    if (lines.length === 0) return;
    await this.lines.insertMany(lines, { ordered: true });
  }

  public async findReview(id: string): Promise<MasRevenueReviewRecord | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.reviews.findById(id).lean().exec();
    return doc ? toReviewRecord(doc as unknown as ReviewLean) : null;
  }

  public async updateReview(
    id: string,
    patch: Partial<MasRevenueReviewRecord>,
  ): Promise<void> {
    const { id: _ignored, createdAt: _createdAt, ...fields } = patch;
    await this.reviews.updateOne({ _id: id }, { $set: fields }).exec();
  }

  public async claimReview(
    id: string,
    from: MasRevenueReviewStatus[],
    to: MasRevenueReviewStatus,
    submitKey: string | null,
  ): Promise<MasRevenueReviewRecord | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.reviews
      .findOneAndUpdate(
        { _id: id, status: { $in: from } },
        { $set: { status: to, ...(submitKey ? { submitKey } : {}) } },
        { new: true },
      )
      .lean()
      .exec();
    return doc ? toReviewRecord(doc as unknown as ReviewLean) : null;
  }

  public async findLines(
    reviewId: string,
  ): Promise<MasRevenueReviewLineRecord[]> {
    const docs = await this.lines
      .find({ reviewId })
      .sort({ position: 1 })
      .lean()
      .exec();
    return docs.map((doc) => toLineRecord(doc as unknown as LineLean));
  }

  public async pageLines(
    reviewId: string,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; items: MasRevenueReviewLineRecord[] }> {
    const [total, docs] = await Promise.all([
      this.lines.countDocuments({ reviewId }).exec(),
      this.lines
        .find({ reviewId })
        .sort({ position: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);
    return {
      total,
      items: docs.map((doc) => toLineRecord(doc as unknown as LineLean)),
    };
  }

  public async findSubmittedReceiptLines(
    company: string,
    invoiceNumbers: string[],
  ): Promise<MasRevenueReviewLineRecord[]> {
    if (invoiceNumbers.length === 0) return [];
    const docs = await this.lines
      .find({
        company,
        invoiceNumber: { $in: invoiceNumbers },
        batchId: { $exists: true, $nin: [null, ''] },
      })
      .lean()
      .exec();
    return docs.map((doc) => toLineRecord(doc as unknown as LineLean));
  }

  public async findReceiptClaims(
    company: string,
    invoiceNumbers: string[],
  ): Promise<MasRevenueReceiptClaimRecord[]> {
    if (invoiceNumbers.length === 0) return [];
    const docs = await this.claims
      .find({ company, invoiceNumber: { $in: invoiceNumbers } })
      .lean()
      .exec();
    return docs.map((doc) => toClaimRecord(doc as unknown as ClaimLean));
  }

  public async claimReceiptIdentities(
    reviewId: string,
    claims: NewMasRevenueReceiptClaim[],
  ): Promise<MasRevenueClaimResult> {
    if (claims.length === 0) return { ok: true };
    try {
      // ordered insert: the first duplicate stops the batch of inserts.
      await this.claims.insertMany(
        claims.map((claim) => ({ ...claim, reviewId, batchId: null })),
        { ordered: true },
      );
      return { ok: true };
    } catch (error) {
      // Compensate: this review keeps no partial claims after a refused reservation.
      await this.claims.deleteMany({ reviewId, batchId: null }).exec();
      const reason = duplicateReason(error);
      if (reason) return { ok: false, reason };
      throw error;
    }
  }

  public async releaseUnbatchedReceiptClaims(reviewId: string): Promise<void> {
    await this.claims.deleteMany({ reviewId, batchId: null }).exec();
  }

  public async attachBatchToReceiptClaims(
    reviewId: string,
    batchId: string,
  ): Promise<void> {
    await this.claims.updateMany({ reviewId }, { $set: { batchId } }).exec();
  }

  public async markLinesSubmitted(
    reviewId: string,
    batchId: string,
  ): Promise<void> {
    await this.lines.updateMany({ reviewId }, { $set: { batchId } }).exec();
  }
}

type ReviewLean = MasRevenueReview & {
  _id: { toString(): string };
  created_at: Date;
  batchId?: string | null;
  submitKey?: string | null;
  lastError?: string | null;
  submittedAt?: Date | null;
  summary?: Record<string, unknown> | null;
};

type LineLean = MasRevenueReviewLine & { batchId?: string | null };

type ClaimLean = MasRevenueReceiptClaim & { batchId?: string | null };

/** Which unique index refused a claim: the identity, or the PaymentId base. Null for other errors. */
function duplicateReason(
  error: unknown,
): 'IDENTITY_TAKEN' | 'PAYMENT_ID_TAKEN' | null {
  const writeErrors = (error as { writeErrors?: unknown[] })?.writeErrors;
  const list = Array.isArray(writeErrors) ? writeErrors : [error];
  for (const item of list) {
    const code =
      (item as { code?: number })?.code ??
      (item as { err?: { code?: number } })?.err?.code;
    if (code !== 11000) continue;
    const message = String(
      (item as { errmsg?: string })?.errmsg ??
        (error as { message?: string })?.message ??
        '',
    );
    return message.includes('uniq_company_payment_id_base')
      ? 'PAYMENT_ID_TAKEN'
      : 'IDENTITY_TAKEN';
  }
  return null;
}

function toReviewRecord(doc: ReviewLean): MasRevenueReviewRecord {
  return {
    id: doc._id.toString(),
    company: doc.company,
    createdByUserId: doc.createdByUserId,
    fileName: doc.fileName,
    templateVersion: doc.templateVersion,
    transactionCurrency: doc.transactionCurrency,
    status: doc.status,
    payloadHash: doc.payloadHash,
    summary: doc.summary ?? null,
    canSubmit: doc.canSubmit,
    receiptCount: doc.receiptCount,
    batchId: doc.batchId ?? null,
    submitKey: doc.submitKey ?? null,
    lastError: doc.lastError ?? null,
    submittedAt: doc.submittedAt ?? null,
    correlationId: doc.correlationId,
    createdAt: doc.created_at,
  };
}

function toLineRecord(doc: LineLean): MasRevenueReviewLineRecord {
  return {
    reviewId: doc.reviewId,
    company: doc.company,
    position: doc.position,
    invoiceNumber: doc.invoiceNumber,
    transactionDate: doc.transactionDate,
    currency: doc.currency,
    raw: doc.raw,
    batchId: doc.batchId ?? null,
  };
}

function toClaimRecord(doc: ClaimLean): MasRevenueReceiptClaimRecord {
  return {
    company: doc.company,
    identityKey: doc.identityKey,
    paymentIdBase: doc.paymentIdBase,
    invoiceNumber: doc.invoiceNumber,
    year: doc.year,
    fingerprint: doc.fingerprint,
    reviewId: doc.reviewId,
    batchId: doc.batchId ?? null,
  };
}
