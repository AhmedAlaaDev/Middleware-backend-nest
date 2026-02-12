import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateExchangeRate,
  IExchangeRate,
  IExchangeRateListFilter,
} from '@/modules/master-data/interfaces/exchange-rate.interface';
import { ExchangeRateRepository } from '@/modules/master-data/repositories/interfaces/exchange-rate.repository';
import { ExchangeRate } from '@/modules/master-data/schemas/exchange-rate.schema';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ExchangeRateMongoRepository implements ExchangeRateRepository {
  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly model: Model<ExchangeRate>,
  ) {}

  private buildFilter(
    filter: IExchangeRateListFilter,
  ): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    if (filter.rateTypeName)
      q['rateTypeName'] = {
        $regex: new RegExp(`^${escapeRegex(filter.rateTypeName)}$`, 'i'),
      };
    if (filter.fromCurrency)
      q['fromCurrency'] = {
        $regex: new RegExp(`^${escapeRegex(filter.fromCurrency)}$`, 'i'),
      };
    if (filter.toCurrency)
      q['toCurrency'] = {
        $regex: new RegExp(`^${escapeRegex(filter.toCurrency)}$`, 'i'),
      };
    if (filter.fromDate) q['startDate'] = { $gte: filter.fromDate } as unknown;
    if (filter.toDate) q['endDate'] = { $lte: filter.toDate } as unknown;
    return q;
  }

  async upsertMany(rates: ICreateExchangeRate[]): Promise<void> {
    const ops = rates.map((r) => ({
      updateOne: {
        filter: {
          rateTypeName: r.rateTypeName,
          fromCurrency: r.fromCurrency,
          toCurrency: r.toCurrency,
          startDate: r.startDate,
        },
        update: { $set: r },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IExchangeRateListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IExchangeRate[]> {
    const q = this.buildFilter(filter);
    let query = this.model.find(q).lean();

    if (options?.skipCount !== undefined) {
      query = query.skip(options.skipCount);
    }

    if (options?.maxCount !== undefined) {
      query = query.limit(options.maxCount);
    }

    const docs = await query.exec();
    return docs.map((er) => ({
      id: er._id.toString(),
      rateTypeName: er.rateTypeName,
      fromCurrency: er.fromCurrency,
      toCurrency: er.toCurrency,
      startDate: er.startDate.toISOString(),
      rate: er.rate,
      endDate: er.endDate.toISOString(),
      conversionFactor: er.conversionFactor,
      rateTypeDescription: er.rateTypeDescription,
    }));
  }

  async getCount(filter: IExchangeRateListFilter): Promise<number> {
    const q = this.buildFilter(filter);
    return this.model.countDocuments(q).exec();
  }
}
