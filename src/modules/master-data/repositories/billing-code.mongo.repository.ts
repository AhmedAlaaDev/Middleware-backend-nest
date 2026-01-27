import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateBillingCode,
  IBillingCode,
  IBillingCodeListFilter,
} from '@/modules/master-data/interfaces/billing-code.interface';
import { BillingCodeRepository } from '@/modules/master-data/repositories/interfaces/billing-code.repository';
import { BillingCode } from '@/modules/master-data/schemas/billing-code.schema';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class BillingCodeMongoRepository implements BillingCodeRepository {
  constructor(
    @InjectModel(BillingCode.name)
    private readonly model: Model<BillingCode>,
  ) {}

  async upsertMany(
    company: string,
    codes: ICreateBillingCode[],
  ): Promise<void> {
    const ops = codes.map((c) => ({
      updateOne: {
        filter: { dataAreaId: company, billingCode: c.billingCode },
        update: { $set: { ...c, dataAreaId: company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IBillingCodeListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingCode[]> {
    const q: Record<string, unknown> = {};
    if (filter.company)
      q['dataAreaId'] = {
        $regex: new RegExp(`^${escapeRegex(filter.company)}$`, 'i'),
      };
    if (filter.billingClassification)
      q['billingClassification'] = {
        $regex: new RegExp(
          `^${escapeRegex(filter.billingClassification)}$`,
          'i',
        ),
      };

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
      billingCode: doc.billingCode,
      billingClassification: doc.billingClassification,
    }));
  }

  async getCount(filter: IBillingCodeListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company)
      q['dataAreaId'] = {
        $regex: new RegExp(`^${escapeRegex(filter.company)}$`, 'i'),
      };
    if (filter.billingClassification)
      q['billingClassification'] = {
        $regex: new RegExp(
          `^${escapeRegex(filter.billingClassification)}$`,
          'i',
        ),
      };
    return this.model.countDocuments(q).exec();
  }
}
