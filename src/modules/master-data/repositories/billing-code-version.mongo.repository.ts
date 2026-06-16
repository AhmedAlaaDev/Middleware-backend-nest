import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  IBillingCodeVersion,
  IBillingCodeVersionListFilter,
  ICreateBillingCodeVersion,
} from '@/modules/master-data/interfaces/billing-code-version.interface';
import { BillingCodeVersionRepository } from '@/modules/master-data/repositories/interfaces/billing-code-version.repository';
import { BillingCodeVersion } from '@/modules/master-data/schemas/billing-code-version.schema';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class BillingCodeVersionMongoRepository implements BillingCodeVersionRepository {
  constructor(
    @InjectModel(BillingCodeVersion.name)
    private readonly model: Model<BillingCodeVersion>,
  ) {}

  async upsertMany(
    company: string,
    versions: ICreateBillingCodeVersion[],
  ): Promise<void> {
    const ops = versions.map((version) => ({
      updateOne: {
        filter: {
          dataAreaId: company,
          billingCode: version.billingCode,
          billingCodeDescription: version.billingCodeDescription,
          validFrom: version.validFrom,
          validTo: version.validTo,
        },
        update: { $set: { ...version, dataAreaId: company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IBillingCodeVersionListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IBillingCodeVersion[]> {
    const queryFilter = this.buildFilter(filter);
    let query = this.model.find(queryFilter).lean();

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
      billingCodeDescription: doc.billingCodeDescription,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      itemSalesTaxGroup: doc.itemSalesTaxGroup,
      rateType: doc.rateType,
    }));
  }

  async getCount(filter: IBillingCodeVersionListFilter): Promise<number> {
    return this.model.countDocuments(this.buildFilter(filter)).exec();
  }

  private buildFilter(
    filter: IBillingCodeVersionListFilter,
  ): Record<string, unknown> {
    const queryFilter: Record<string, unknown> = {};
    if (filter.company) {
      queryFilter['dataAreaId'] = {
        $regex: new RegExp(`^${escapeRegex(filter.company)}$`, 'i'),
      };
    }
    if (filter.billingCode) {
      queryFilter['billingCode'] = {
        $regex: new RegExp(`^${escapeRegex(filter.billingCode)}$`, 'i'),
      };
    }
    if (filter.billingCodeDescription) {
      queryFilter['billingCodeDescription'] = filter.billingCodeDescription;
    }
    return queryFilter;
  }
}
