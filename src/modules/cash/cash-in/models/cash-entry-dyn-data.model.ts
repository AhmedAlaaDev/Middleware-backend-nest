import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { DynDataModel } from '@/modules/entry-processor/models/entry-processor.model';

type AccountType = 'Cust' | 'Ledger' | 'Vend' | 'Bank' | 'Petty cash';

export class CashEntryDynDataModel extends DynDataModel {
  AccountDisplayValue: string;
  OffsetAccountDisplayValue: string;

  AccountType: AccountType;
  OffsetAccountType: AccountType;

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

  constructor(
    data: CashEntryDynDataModel,
    dimensionModel: AccountDimensionsModel,
  ) {
    super(data, dimensionModel);

    this.AccountDisplayValue = data.AccountDisplayValue;
    this.OffsetAccountDisplayValue = data.OffsetAccountDisplayValue;
    this.AccountType = data.AccountType;
    this.OffsetAccountType = data.OffsetAccountType;
    this.Company = data.Company;
    this.OffsetCompany = data.OffsetCompany;
    this.CurrencyCode = data.CurrencyCode;
    this.CreditAmount = data.CreditAmount;
    this.DebitAmount = data.DebitAmount;
    this.ExchangeRate = data.ExchangeRate;
    this.SecondaryExchangeRate = data.SecondaryExchangeRate;
    this.ReportingCurrencyExchRate = data.ReportingCurrencyExchRate;
    this.ReportingCurrencyExchRateSecondary =
      data.ReportingCurrencyExchRateSecondary;
    this.PostingProfile = data.PostingProfile;
    this.MarkedInvoice = data.MarkedInvoice;
    this.CalculateWithholdingTax = data.CalculateWithholdingTax;
    this.CustomerName = data.CustomerName;
    this.DefaultDimensionsForAccountDisplayValue =
      data.DefaultDimensionsForAccountDisplayValue;
    this.DefaultDimensionsForOffsetAccountDisplayValue =
      data.DefaultDimensionsForOffsetAccountDisplayValue;
    this.FinTagDisplayValue = data.FinTagDisplayValue;
    this.OffsetFinTagDisplayValue = data.OffsetFinTagDisplayValue;
    this.IsPrepayment = data.IsPrepayment;
    this.MarkedInvoiceCompany = data.MarkedInvoiceCompany;
    this.PaymentReference = data.PaymentReference;
  }
}
