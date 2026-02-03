import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateTaxItemGroupHeading,
  ITaxItemGroupHeading,
  ITaxItemGroupHeadingListFilter,
} from '@/modules/master-data/interfaces/tax-item-group-heading.interface';
import { TaxItemGroupHeadingRepository } from '@/modules/master-data/repositories/interfaces/tax-item-group-heading.repository';
import { TaxItemGroupHeading } from '@/modules/master-data/schemas/tax-item-group-heading.schema';

@Injectable()
export class TaxItemGroupHeadingMongoRepository implements TaxItemGroupHeadingRepository {
  constructor(
    @InjectModel(TaxItemGroupHeading.name)
    private readonly model: Model<TaxItemGroupHeading>,
  ) {}

  async upsertMany(
    company: string,
    items: ICreateTaxItemGroupHeading[],
  ): Promise<void> {
    const ops = items.map((item) => ({
      updateOne: {
        filter: {
          dataAreaId: company,
          taxItemGroup: item.taxItemGroup,
        },
        update: {
          $set: {
            ...item,
            dataAreaId: item.dataAreaId || company,
          },
        },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: ITaxItemGroupHeadingListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ITaxItemGroupHeading[]> {
    const q: Record<string, unknown> = {};
    if (filter.dataAreaId) q['dataAreaId'] = filter.dataAreaId;
    if (filter.taxItemGroup) {
      q['taxItemGroup'] = {
        $regex: new RegExp(`^${escapeRegex(filter.taxItemGroup)}$`, 'i'),
      };
    }

    let query = this.model.find(q).lean();

    if (options?.skipCount !== undefined) {
      query = query.skip(options.skipCount);
    }
    if (options?.maxCount !== undefined) {
      query = query.limit(options.maxCount);
    }

    const docs = await query.exec();
    return docs.map((doc: any) => ({
      id: doc._id.toString(),
      dataAreaId: doc.dataAreaId,
      taxItemGroup: doc.taxItemGroup,
      name: doc.name,
    }));
  }

  async getCount(filter: ITaxItemGroupHeadingListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.dataAreaId) q['dataAreaId'] = filter.dataAreaId;
    if (filter.taxItemGroup) {
      q['taxItemGroup'] = {
        $regex: new RegExp(`^${escapeRegex(filter.taxItemGroup)}$`, 'i'),
      };
    }
    return this.model.countDocuments(q).exec();
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
