import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateFinancialDimension,
  ICreateFinancialDimensionValue,
  IFinancialDimension,
  IFinancialDimensionValue,
  IFinancialDimensionValueListFilter,
} from '@/modules/master-data/interfaces/financial-dimension.interface';
import {
  FinancialDimensionRepository,
  FinancialDimensionValueRepository,
} from '@/modules/master-data/repositories/interfaces/financial-dimension.repository';
import { FinancialDimensionValue } from '@/modules/master-data/schemas/financial-dimension-value.schema';
import { FinancialDimension } from '@/modules/master-data/schemas/financial-dimension.schema';

@Injectable()
export class FinancialDimensionMongoRepository implements FinancialDimensionRepository {
  constructor(
    @InjectModel(FinancialDimension.name)
    private readonly model: Model<FinancialDimension>,
  ) {}

  async upsertMany(items: ICreateFinancialDimension[]): Promise<void> {
    const ops = items.map((d) => ({
      updateOne: {
        filter: { financialKey: d.financialKey },
        update: { $set: d },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(options?: {
    skipCount?: number;
    maxCount?: number;
  }): Promise<IFinancialDimension[]> {
    const skip = options?.skipCount ?? 0;
    const limit = options?.maxCount ?? 150;
    const docs = await this.model
      .find({})
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc) => ({
      id: (doc as { _id: { toString(): string } })._id.toString(),
      financialKey: (doc as { financialKey: string }).financialKey,
    }));
  }

  async findByKey(financialKey: string): Promise<IFinancialDimension | null> {
    const doc = await this.model.findOne({ financialKey }).lean().exec();
    if (!doc) return null;
    return {
      id: (doc as { _id: { toString(): string } })._id.toString(),
      financialKey: (doc as { financialKey: string }).financialKey,
    };
  }
}

@Injectable()
export class FinancialDimensionValueMongoRepository implements FinancialDimensionValueRepository {
  constructor(
    @InjectModel(FinancialDimensionValue.name)
    private readonly model: Model<FinancialDimensionValue>,
  ) {}

  async upsertMany(values: ICreateFinancialDimensionValue[]): Promise<void> {
    const ops = values.map((v) => ({
      updateOne: {
        filter: {
          financialDimensionKey: v.financialDimensionKey,
          value: v.value,
        },
        update: { $set: v },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IFinancialDimensionValueListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IFinancialDimensionValue[]> {
    const q: Record<string, unknown> = {};
    if (filter.financialDimensionKey)
      q['financialDimensionKey'] = filter.financialDimensionKey;
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
      financialDimensionKey: doc.financialDimensionKey,
      value: doc.value,
      description: doc.description,
    }));
  }
}
