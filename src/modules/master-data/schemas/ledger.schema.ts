import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LedgerDocument = HydratedDocument<Ledger>;

@Schema({
  collection: 'ledgers',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Ledger {
  @Prop({ required: true, index: true })
  legalEntityId: string;

  @Prop({ required: true })
  accountingCurrency: string;

  @Prop({ required: true })
  reportingCurrency: string;

  @Prop()
  name?: string;

  @Prop()
  description?: string;

  @Prop()
  chartOfAccounts?: string;

  @Prop()
  fiscalCalendar?: string;

  @Prop()
  reportingCurrencyExchangeRateType?: string;

  @Prop()
  budgetExchangeRateType?: string;

  @Prop()
  exchangeRateType?: string;

  @Prop()
  chartOfAccountsRecId?: number;

  @Prop()
  ledgerRecId?: number;

  @Prop()
  accountStructureName1?: string;

  @Prop()
  accountStructureName2?: string;

  @Prop()
  accountStructureName3?: string;

  @Prop()
  accountStructureName4?: string;

  @Prop()
  accountStructureName5?: string;

  @Prop()
  accountStructureName6?: string;

  @Prop()
  accountStructureName7?: string;

  @Prop()
  accountStructureName8?: string;

  @Prop()
  accountStructureName9?: string;

  @Prop()
  accountStructureName10?: string;

  @Prop()
  accountStructureName11?: string;

  @Prop()
  accountStructureName12?: string;

  @Prop()
  accountStructureName13?: string;

  @Prop()
  accountStructureName14?: string;

  @Prop()
  accountStructureName15?: string;

  @Prop()
  accountStructureName16?: string;

  @Prop()
  accountStructureName17?: string;

  @Prop()
  accountStructureName18?: string;

  @Prop()
  accountStructureName19?: string;

  @Prop()
  accountStructureName20?: string;

  @Prop()
  mainAccountIdUnrealizedLoss?: string;

  @Prop()
  mainAccountIdRealizedGain?: string;

  @Prop()
  mainAccountIdRealizedLoss?: string;

  @Prop()
  mainAccountIdFinancialGain?: string;

  @Prop()
  mainAccountIdUnrealizedGain?: string;

  @Prop()
  mainAccountIdFinancialLoss?: string;

  @Prop()
  isBudgetControlEnabled?: string;

  @Prop()
  balancingFinancialDimension?: string;
}

export const LedgerSchema = SchemaFactory.createForClass(Ledger);

LedgerSchema.index({ legalEntityId: 1 }, { unique: true });
