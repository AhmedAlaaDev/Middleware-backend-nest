import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateMainAccount,
  IMainAccount,
  IMainAccountListFilter,
} from '@/modules/master-data/interfaces/main-account.interface';
import { MainAccountRepository } from '@/modules/master-data/repositories/interfaces/main-account.repository';
import { MainAccount } from '@/modules/master-data/schemas/main-account.schema';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class MainAccountMongoRepository implements MainAccountRepository {
  constructor(
    @InjectModel(MainAccount.name)
    private readonly model: Model<MainAccount>,
  ) {}

  async upsertMany(
    chartNumber: string,
    accounts: ICreateMainAccount[],
  ): Promise<void> {
    const ops = accounts.map((a) => ({
      updateOne: {
        filter: { chartNumber, accountNumber: a.accountNumber },
        update: { $set: { ...a, chartNumber } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IMainAccountListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IMainAccount[]> {
    const q: Record<string, unknown> = {};
    if (filter.chartNumber) q['chartNumber'] = filter.chartNumber;
    if (filter.accountName) {
      q['accountName'] = {
        $regex: new RegExp(escapeRegex(filter.accountName), 'i'),
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
    return docs.map((doc) => ({
      id: doc._id.toString(),
      chartNumber: doc.chartNumber,
      accountNumber: doc.accountNumber,
      accountName: doc.accountName,
      mainAccountType: doc.mainAccountType,
      isSuspended: doc.isSuspended,
      doNotAllowManualEntry: doc.doNotAllowManualEntry,
    }));
  }

  async getCount(filter: IMainAccountListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.chartNumber) q['chartNumber'] = filter.chartNumber;
    if (filter.accountName) {
      q['accountName'] = {
        $regex: new RegExp(escapeRegex(filter.accountName), 'i'),
      };
    }
    return this.model.countDocuments(q).exec();
  }
}
