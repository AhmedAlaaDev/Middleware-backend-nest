import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateLedger,
  ILedger,
  ILedgerListFilter,
} from '@/modules/master-data/interfaces/ledger.interface';
import { LedgerRepository } from '@/modules/master-data/repositories/interfaces/ledger.repository';
import { Ledger } from '@/modules/master-data/schemas/ledger.schema';

@Injectable()
export class LedgerMongoRepository implements LedgerRepository {
  constructor(
    @InjectModel(Ledger.name)
    private readonly model: Model<Ledger>,
  ) {}

  async upsertMany(company: string, ledgers: ICreateLedger[]): Promise<void> {
    const ops = ledgers.map((ledger) => ({
      updateOne: {
        filter: { legalEntityId: company },
        update: { $set: { ...ledger, legalEntityId: company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: ILedgerListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ILedger[]> {
    const q: Record<string, unknown> = {};
    if (filter.company) {
      q['legalEntityId'] = {
        $regex: new RegExp(`^${filter.company}$`, 'i'),
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
      legalEntityId: doc.legalEntityId,
      accountingCurrency: doc.accountingCurrency,
      reportingCurrency: doc.reportingCurrency,
      name: doc.name,
      description: doc.description,
      chartOfAccounts: doc.chartOfAccounts,
      fiscalCalendar: doc.fiscalCalendar,
      reportingCurrencyExchangeRateType: doc.reportingCurrencyExchangeRateType,
      budgetExchangeRateType: doc.budgetExchangeRateType,
      exchangeRateType: doc.exchangeRateType,
      chartOfAccountsRecId: doc.chartOfAccountsRecId,
      ledgerRecId: doc.ledgerRecId,
      accountStructureName1: doc.accountStructureName1,
      accountStructureName2: doc.accountStructureName2,
      accountStructureName3: doc.accountStructureName3,
      accountStructureName4: doc.accountStructureName4,
      accountStructureName5: doc.accountStructureName5,
      accountStructureName6: doc.accountStructureName6,
      accountStructureName7: doc.accountStructureName7,
      accountStructureName8: doc.accountStructureName8,
      accountStructureName9: doc.accountStructureName9,
      accountStructureName10: doc.accountStructureName10,
      accountStructureName11: doc.accountStructureName11,
      accountStructureName12: doc.accountStructureName12,
      accountStructureName13: doc.accountStructureName13,
      accountStructureName14: doc.accountStructureName14,
      accountStructureName15: doc.accountStructureName15,
      accountStructureName16: doc.accountStructureName16,
      accountStructureName17: doc.accountStructureName17,
      accountStructureName18: doc.accountStructureName18,
      accountStructureName19: doc.accountStructureName19,
      accountStructureName20: doc.accountStructureName20,
      mainAccountIdUnrealizedLoss: doc.mainAccountIdUnrealizedLoss,
      mainAccountIdRealizedGain: doc.mainAccountIdRealizedGain,
      mainAccountIdRealizedLoss: doc.mainAccountIdRealizedLoss,
      mainAccountIdFinancialGain: doc.mainAccountIdFinancialGain,
      mainAccountIdUnrealizedGain: doc.mainAccountIdUnrealizedGain,
      mainAccountIdFinancialLoss: doc.mainAccountIdFinancialLoss,
      isBudgetControlEnabled: doc.isBudgetControlEnabled,
      balancingFinancialDimension: doc.balancingFinancialDimension,
    }));
  }

  async getCount(filter: ILedgerListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company) {
      q['legalEntityId'] = {
        $regex: new RegExp(`^${filter.company}$`, 'i'),
      };
    }
    return this.model.countDocuments(q).exec();
  }
}
