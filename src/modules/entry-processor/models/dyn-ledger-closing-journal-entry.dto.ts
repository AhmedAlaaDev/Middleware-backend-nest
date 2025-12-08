import { DynDataModel } from '@/modules/entry-processor/models/dyn-data-model';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class DynLedgerClosingJournalEntryDto extends DynDataModel {
  CustomId: number;
  UniqueId?: number;
  LineNumber?: number;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
  Voucher: string;
  TransDate: Date;
  AccountType: string;
  AccountDisplayValue: string;
  DefaultDimensionDisplayValue: string;
  FinTagDisplayValue: string;
  Text: string;
  DebitAmount: number;
  CreditAmount: number;
  CurrencyCode: string;
  ExchangeRate: number;
  OffsetAccountType: string;
  OffsetAccountDisplayValue: string;
  OffsetDefaultDimensionDisplayValue: string;
  OffsetFinTagDisplayValue: string;
  OffsetText: string;
  Prepayment: string;
  SalesTaxGroup: string;
  ItemSalesTaxGroup: string;
  TaxExemptNumber: string;
  IsWithholdingCalculationEnabled: string;
  ItemWithholdingTaxGroupCode: string;
  Document: string;
  DocumentDate?: Date;
  DueDate?: Date;
  Invoice: string;
  PaymentMethod: string;
  PaymentReference: string;
  CashDiscount: string;
  CashDiscountAmount: number;
  CashDiscountDate?: Date;
  ExchangeRateSecondary: number;
  OverrideSalesTax: string;
  PaymentId: string;
  Quantity: number;
  ReportingCurrencyExchRateSecondary: number;
  ReportingCurrencyExchRate: number;
  ReverseDate?: Date;
  ReverseEntry: string;
  SalesTaxCode: string;
  PostingProfile: string;
  PostingLayer: string;
  IsPosted: string;

  DimensionModel?: AccountDimensionsModel;
}

