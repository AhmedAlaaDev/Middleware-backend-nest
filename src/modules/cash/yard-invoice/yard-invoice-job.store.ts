import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { YardInvoiceReviewLine } from './yard-invoice-preview.service';
import {
  YardInvoiceReviewLineDoc,
  YardInvoiceJobStatus,
  YardInvoiceUploadJob,
} from './yard-invoice-upload-job.schema';

export interface YardInvoiceJobRecord {
  id: string;
  company: string;
  createdByUserId: string;
  fileName: string;
  flow: 'YARD' | 'SHIPLINK';
  format: string | null;
  payloadHash: string | null;
  status: YardInvoiceJobStatus;
  summary: Record<string, unknown> | null;
  invoiceCount: number;
  canSubmit: boolean;
  batchId: string | null;
  postingJobId: string | null;
  submissionStatus: string | null;
  lastError: string | null;
  correlationId: string;
  submittedAt: Date | null;
  updatedAt: Date;
}

export type YardInvoiceJobPatch = Partial<
  Omit<YardInvoiceJobRecord, 'id' | 'company' | 'createdByUserId' | 'updatedAt'>
>;

/** Fields supplied when a job is created. */
export interface NewYardInvoiceJob {
  company: string;
  createdByUserId: string;
  fileName: string;
  status: YardInvoiceJobStatus;
  correlationId: string;
  flow?: 'YARD' | 'SHIPLINK';
}

export interface YardInvoiceLinePage {
  total: number;
  items: YardInvoiceReviewLine[];
}

/**
 * Persistence port for upload jobs and their reviewed lines. The Mongo adapter
 * is the production implementation; tests use an in-memory store with the same
 * semantics.
 */
export abstract class YardInvoiceJobStore {
  abstract create(record: NewYardInvoiceJob): Promise<YardInvoiceJobRecord>;
  abstract findById(id: string): Promise<YardInvoiceJobRecord | null>;
  /**
   * Atomically moves the job from one of `from` to `to`. Returns the updated
   * record, or null when the job is not in an allowed status. This is the
   * only way to start a submission, which prevents concurrent double submits.
   */
  abstract claim(
    id: string,
    from: YardInvoiceJobStatus[],
    to: YardInvoiceJobStatus,
  ): Promise<YardInvoiceJobRecord | null>;
  abstract update(id: string, patch: YardInvoiceJobPatch): Promise<void>;
  /** Replaces all reviewed lines of a job. */
  abstract replaceLines(
    jobId: string,
    lines: YardInvoiceReviewLine[],
  ): Promise<void>;
  abstract pageLines(
    jobId: string,
    page: number,
    pageSize: number,
  ): Promise<YardInvoiceLinePage>;
}

@Injectable()
export class MongoYardInvoiceJobStore extends YardInvoiceJobStore {
  private static readonly LINE_BATCH = 500;

  constructor(
    @InjectModel(YardInvoiceUploadJob.name)
    private readonly model: Model<YardInvoiceUploadJob>,
    @InjectModel(YardInvoiceReviewLineDoc.name)
    private readonly lines: Model<YardInvoiceReviewLineDoc>,
  ) {
    super();
  }

  public async create(
    record: NewYardInvoiceJob,
  ): Promise<YardInvoiceJobRecord> {
    const doc = await this.model.create(record);
    return toRecord(doc.toObject() as unknown as Record<string, unknown>);
  }

  public async findById(id: string): Promise<YardInvoiceJobRecord | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toRecord(doc as unknown as Record<string, unknown>) : null;
  }

  public async claim(
    id: string,
    from: YardInvoiceJobStatus[],
    to: YardInvoiceJobStatus,
  ): Promise<YardInvoiceJobRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, status: { $in: from } },
        { $set: { status: to } },
        { new: true },
      )
      .lean()
      .exec();
    return doc ? toRecord(doc as unknown as Record<string, unknown>) : null;
  }

  public async update(id: string, patch: YardInvoiceJobPatch): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: patch }).exec();
  }

  public async replaceLines(
    jobId: string,
    lines: YardInvoiceReviewLine[],
  ): Promise<void> {
    await this.lines.deleteMany({ jobId }).exec();
    for (
      let start = 0;
      start < lines.length;
      start += MongoYardInvoiceJobStore.LINE_BATCH
    ) {
      const slice = lines.slice(
        start,
        start + MongoYardInvoiceJobStore.LINE_BATCH,
      );
      await this.lines.insertMany(
        slice.map((line, index) => ({
          jobId,
          position: start + index,
          invoiceNumber: line.invoiceNumber,
          line: line as unknown as Record<string, unknown>,
        })),
        { ordered: true },
      );
    }
  }

  public async pageLines(
    jobId: string,
    page: number,
    pageSize: number,
  ): Promise<YardInvoiceLinePage> {
    const safePage = Math.max(1, Math.floor(page));
    const size = Math.max(1, Math.min(Math.floor(pageSize), 500));
    const [total, docs] = await Promise.all([
      this.lines.countDocuments({ jobId }).exec(),
      this.lines
        .find({ jobId })
        .sort({ position: 1 })
        .skip((safePage - 1) * size)
        .limit(size)
        .lean()
        .exec(),
    ]);
    return {
      total,
      items: docs.map(
        (doc) => (doc as unknown as { line: YardInvoiceReviewLine }).line,
      ),
    };
  }
}

function toRecord(doc: Record<string, unknown>): YardInvoiceJobRecord {
  return {
    id: String(doc._id),
    company: String(doc.company),
    createdByUserId: String(doc.createdByUserId),
    fileName: typeof doc.fileName === 'string' ? doc.fileName : '',
    flow: doc.flow === 'SHIPLINK' ? 'SHIPLINK' : 'YARD',
    format: typeof doc.format === 'string' ? doc.format : null,
    payloadHash: typeof doc.payloadHash === 'string' ? doc.payloadHash : null,
    status: doc.status as YardInvoiceJobStatus,
    summary: (doc.summary as Record<string, unknown> | undefined) ?? null,
    invoiceCount: Number(doc.invoiceCount ?? 0),
    canSubmit: doc.canSubmit === true,
    batchId: typeof doc.batchId === 'string' ? doc.batchId : null,
    postingJobId:
      typeof doc.postingJobId === 'string' ? doc.postingJobId : null,
    submissionStatus:
      typeof doc.submissionStatus === 'string' ? doc.submissionStatus : null,
    lastError: typeof doc.lastError === 'string' ? doc.lastError : null,
    correlationId: String(doc.correlationId),
    submittedAt: (doc.submittedAt as Date | undefined) ?? null,
    updatedAt: (doc.updated_at as Date | undefined) ?? new Date(0),
  };
}
