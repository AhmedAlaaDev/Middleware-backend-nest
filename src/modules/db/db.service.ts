import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppSetting } from '@/modules/db/schemas/app-setting.schema';
import { CacheEntry } from '@/modules/db/schemas/cache-entry.schema';
import { LedgerEntryBatchCounter } from '@/modules/db/schemas/ledger-entry-batch-counter.schema';
import { LedgerVoucherCounter } from '@/modules/db/schemas/ledger-voucher-counter.schema';

@Injectable()
export class DBService {
  constructor(
    @InjectModel(AppSetting.name)
    private readonly _appSettingModel: Model<AppSetting>,
    @InjectModel(CacheEntry.name)
    private readonly _cacheEntryModel: Model<CacheEntry>,
    @InjectModel(LedgerEntryBatchCounter.name)
    private readonly _ledgerEntryBatchCounterModel: Model<LedgerEntryBatchCounter>,
    @InjectModel(LedgerVoucherCounter.name)
    private readonly _ledgerVoucherCounterModel: Model<LedgerVoucherCounter>,
  ) {}

  public get appSettingModel() {
    return this._appSettingModel;
  }

  public get cacheEntryModel() {
    return this._cacheEntryModel;
  }

  public get ledgerEntryBatchCounterModel() {
    return this._ledgerEntryBatchCounterModel;
  }

  public get ledgerVoucherCounterModel() {
    return this._ledgerVoucherCounterModel;
  }
}
