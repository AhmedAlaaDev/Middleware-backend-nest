import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateBillingClassification,
  IBillingClassification,
  IBillingClassificationListFilter,
} from '@/modules/master-data/interfaces/billing-classification.interface';
import { BillingClassificationRepository } from '@/modules/master-data/repositories/interfaces/billing-classification.repository';
import { BillingClassification } from '@/modules/master-data/schemas/billing-classification.schema';

@Injectable()
export class BillingClassificationMongoRepository implements BillingClassificationRepository {
  constructor(
    @InjectModel(BillingClassification.name)
    private readonly model: Model<BillingClassification>,
  ) {}

  async upsertMany(
    company: string,
    items: ICreateBillingClassification[],
  ): Promise<void> {
    const ops = items.map((c) => ({
      updateOne: {
        filter: {
          dataAreaId: company,
          billingClassification: c.billingClassification,
        },
        update: { $set: { ...c, dataAreaId: company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IBillingClassificationListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingClassification[]> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['dataAreaId'] = filter.company;

    let query = this.model.find(q).lean();

    if (options?.skipCount !== undefined) {
      query = query.skip(options.skipCount);
    }

    if (options?.maxCount !== undefined) {
      query = query.limit(options.maxCount);
    }

    const docs = await query.exec();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      dataAreaId: doc.dataAreaId,
      billingClassification: doc.billingClassification,
      creditNoteNumber: doc.creditNoteNumber,
      useInterestCodeFromPostingProfile: doc.useInterestCodeFromPostingProfile,
      invoiceNumber: doc.invoiceNumber,
      interestCode: doc.interestCode,
      description: doc.description,
      collectionLetterSequence: doc.collectionLetterSequence,
      restrictSettlementOfCreditNotes: doc.restrictSettlementOfCreditNotes,
      useCollectionLetterSequenceFromPostingProfile:
        doc.useCollectionLetterSequenceFromPostingProfile,
      termsOfPayment: doc.termsOfPayment,
    }));
  }

  async getCount(filter: IBillingClassificationListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['dataAreaId'] = filter.company;
    return this.model.countDocuments(q).exec();
  }
}
