import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AccountCustomerInvoiceMapping } from '@/modules/db/schemas/account-customer-invoice-mapping.schema';
import { AppSetting } from '@/modules/db/schemas/app-setting.schema';
import { CacheEntry } from '@/modules/db/schemas/cache-entry.schema';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';
import { DataBatch } from '@/modules/db/schemas/data-batch.schema';
import { DataEnhancedRecord } from '@/modules/db/schemas/data-enhanced-record.schema';
import { DataSourceRecord } from '@/modules/db/schemas/data-source-record.schema';
import { FinancialDimensionValue } from '@/modules/db/schemas/financial-dimension-value.schema';
import { FinancialDimension } from '@/modules/db/schemas/financial-dimension.schema';
import { LedgerEntryBatchCounter } from '@/modules/db/schemas/ledger-entry-batch-counter.schema';
import { LedgerVoucherCounter } from '@/modules/db/schemas/ledger-voucher-counter.schema';
import { MainAccount } from '@/modules/db/schemas/main-account.schema';
import { BillingClassification } from '@/modules/db/schemas/billing-classification.schema';
import { BillingCode } from '@/modules/db/schemas/billing-code.schema';

@Injectable()
export class DBService {
  constructor(
    @InjectModel(AccountCustomerInvoiceMapping.name)
    private readonly _accountCustomerInvoiceMappingModel: Model<AccountCustomerInvoiceMapping>,
    @InjectModel(AppSetting.name)
    private readonly _appSettingModel: Model<AppSetting>,
    @InjectModel(CacheEntry.name)
    private readonly _cacheEntryModel: Model<CacheEntry>,
    @InjectModel(DataBatch.name)
    private readonly _dataBatchModel: Model<DataBatch>,
    @InjectModel(DataBatchError.name)
    private readonly _dataBatchErrorModel: Model<DataBatchError>,
    @InjectModel(DataEnhancedRecord.name)
    private readonly _dataEnhancedRecordModel: Model<DataEnhancedRecord>,
    @InjectModel(DataSourceRecord.name)
    private readonly _dataSourceRecordModel: Model<DataSourceRecord>,
    @InjectModel(FinancialDimension.name)
    private readonly _financialDimensionModel: Model<FinancialDimension>,
    @InjectModel(FinancialDimensionValue.name)
    private readonly _financialDimensionValueModel: Model<FinancialDimensionValue>,
    @InjectModel(LedgerEntryBatchCounter.name)
    private readonly _ledgerEntryBatchCounterModel: Model<LedgerEntryBatchCounter>,
    @InjectModel(LedgerVoucherCounter.name)
    private readonly _ledgerVoucherCounterModel: Model<LedgerVoucherCounter>,
    @InjectModel(MainAccount.name)
    private readonly _mainAccountModel: Model<MainAccount>,
    @InjectModel(BillingClassification.name)
    private readonly _billingClassificationModel: Model<BillingClassification>,
    @InjectModel(BillingCode.name)
    private readonly _billingCodeModel: Model<BillingCode>,
  ) {}

  public get accountCustomerInvoiceMappingModel() {
    return this._accountCustomerInvoiceMappingModel;
  }

  public get appSettingModel() {
    return this._appSettingModel;
  }

  public get cacheEntryModel() {
    return this._cacheEntryModel;
  }

  public get dataBatchModel() {
    return this._dataBatchModel;
  }

  public get dataBatchErrorModel() {
    return this._dataBatchErrorModel;
  }

  public get dataEnhancedRecordModel() {
    return this._dataEnhancedRecordModel;
  }

  public get dataSourceRecordModel() {
    return this._dataSourceRecordModel;
  }

  public get financialDimensionModel() {
    return this._financialDimensionModel;
  }

  public get financialDimensionValueModel() {
    return this._financialDimensionValueModel;
  }

  public get ledgerEntryBatchCounterModel() {
    return this._ledgerEntryBatchCounterModel;
  }

  public get ledgerVoucherCounterModel() {
    return this._ledgerVoucherCounterModel;
  }

  public get mainAccountModel() {
    return this._mainAccountModel;
  }

  public get billingClassificationModel() {
    return this._billingClassificationModel;
  }

  public get billingCodeModel() {
    return this._billingCodeModel;
  }
}
