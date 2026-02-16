import { EntryAccountType } from '@/common/types/entry-account-type.type';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { DynDataModel } from '@/modules/entry-processor/models/entry-processor.model';

export class CashEntryDynDataModel extends DynDataModel {
  AccountDisplayValue: string;
  OffsetAccountDisplayValue: string;

  OffsetAccountType: EntryAccountType;

  Company: string;
  OffsetCompany: string;

  CurrencyCode: string;
  CreditAmount: number;
  DebitAmount: number;

  ExchangeRate: number;
  SecondaryExchangeRate: number;
  ReportingCurrencyExchRate: number;
  ReportingCurrencyExchRateSecondary: number;

  PostingProfile: string;
  MarkedInvoice: string;

  CalculateWithholdingTax: 'Yes' | 'No';
  CustomerName: string;

  DefaultDimensionsForAccountDisplayValue: string;
  DefaultDimensionsForOffsetAccountDisplayValue: string;

  FinTagDisplayValue: string;
  OffsetFinTagDisplayValue: string;

  IsPrepayment: 'Yes' | 'No';
  MarkedInvoiceCompany: string;

  PaymentReference: string;
  PaymentMethod: string;

  SalesTaxGroup: string;

  VoucherType: string;
  OffsetVoucherType: string;

  constructor(
    dimensionModel: AccountDimensionsModel,
    data: Partial<CashEntryDynDataModel>,
  ) {
    super(data, dimensionModel);

    this.AccountDisplayValue = data.AccountDisplayValue || '';
    this.OffsetAccountDisplayValue = data.OffsetAccountDisplayValue || '';
    this.AccountType = data.AccountType || ('' as EntryAccountType);
    this.OffsetAccountType = data.OffsetAccountType || ('' as EntryAccountType);
    this.Company = data.Company || '';
    this.OffsetCompany = data.OffsetCompany || '';
    this.CurrencyCode = data.CurrencyCode || '';
    this.CreditAmount = data.CreditAmount || 0;
    this.DebitAmount = data.DebitAmount || 0;
    this.ExchangeRate = data.ExchangeRate || 0;
    this.SecondaryExchangeRate = data.SecondaryExchangeRate || 0;
    this.ReportingCurrencyExchRate = data.ReportingCurrencyExchRate || 0;
    this.ReportingCurrencyExchRateSecondary =
      data.ReportingCurrencyExchRateSecondary || 0;
    this.PostingProfile = data.PostingProfile || '';
    this.MarkedInvoice = data.MarkedInvoice || '';
    this.CalculateWithholdingTax = data.CalculateWithholdingTax || 'No';
    this.CustomerName = data.CustomerName || '';
    this.DefaultDimensionsForAccountDisplayValue =
      data.DefaultDimensionsForAccountDisplayValue || '';
    this.DefaultDimensionsForOffsetAccountDisplayValue =
      data.DefaultDimensionsForOffsetAccountDisplayValue || '';
    this.FinTagDisplayValue = data.FinTagDisplayValue || '';
    this.OffsetFinTagDisplayValue = data.OffsetFinTagDisplayValue || '';
    this.IsPrepayment = data.IsPrepayment || 'No';
    this.MarkedInvoiceCompany = data.MarkedInvoiceCompany || '';
    this.PaymentReference = data.PaymentReference || '';
    this.PaymentMethod = data.PaymentMethod || '';
    this.SalesTaxGroup = data.SalesTaxGroup || '';
    this.VoucherType = data.VoucherType || '';
    this.OffsetVoucherType = data.OffsetVoucherType || '';
  }
}
