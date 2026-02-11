import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

/* ------------------------------ LINE ------------------------------ */
/* D365 field names from cash-in-maping.json, keys in PascalCase. */

export class CashInFreightDFOLineBase {
  JournalBatchNumber: string;
  LineNumber: number;

  AccountDisplayValue: string;
  AccountType: string;

  Company: string;

  CurrencyCode: string;
  CreditAmount: number;
  DebitAmount: number;

  ExchangeRate: number;

  TransactionDate: string;
  TransactionText: string;

  PostingProfile: string;
  MarkedInvoice: string;

  CalculateWithholdingTax: 'Yes' | 'No';

  CustomerName: string;

  DefaultDimensionsForAccountDisplayValue: string;
  DefaultDimensionsForOffsetAccountDisplayValue: string;

  FinTagDisplayValue: string;

  IsPrepayment: 'Yes' | 'No';

  MarkedInvoiceCompany: string;

  OffsetAccountDisplayValue: string;
  OffsetAccountType: string;
  OffsetCompany: string;

  ReportingCurrencyExchRate: number | string;
  ReportingCurrencyExchRateSecondary: number;
  SecondaryExchangeRate: number | string;

  TaxGroup: string;

  TransactionDateD365: string;
  Voucher: string;

  UseABankDepositSlip?: string;
  UseSalesTaxDirectionFromMainAccount?: string;

  PaymentId: string;
  OffsetFinTagDisplayValue: string;
  OffsetTransactionText: string;
  JournalName: string;

  /* Optional (mapping notes: Optional or empty source) */
  BankTransactionType?: string;
  CentralBankImportDate?: string;
  CentralBankPurposeCode?: string;
  CentralBankPurposeText?: string;
  DepositNumber?: string;
  ItemWithholdingTaxGroup?: string;
  NachaIatForeignExchangeIndicator?: string;
  NachaIatForeignExchangeReference?: string;
  NachaIatForeignExchangeReferenceIndicator?: string;
  NachaIatOfacScreeningIndicator?: string;
  NachaIatOfacSecondaryScreeningIndicator?: string;
  NachaIatOriginatingDfiQualifier?: string;
  NachaIatReceivingDfiQualifier?: string;
  OverrideSalesTax?: string;
  PaymentMethodName?: string;
  PaymentNotes?: string;
  PaymentReference?: string;
  PaymentSpecification?: string;
  PostDatedCheckBankBranch?: string;
  PostDatedCheckBankName?: string;
  PostDatedCheckCashierDisplayValue?: string;
  PostDatedCheckIsReplacementCheck?: string;
  PostDatedCheckMaturityDate?: string;
  PostDatedCheckNumber?: string;
  PostDatedCheckOriginalCheckNumber?: string;
  PostDatedCheckReasonForStop?: string;
  PostDatedCheckReceivedDate?: string;
  PostDatedCheckReplacementComments?: string;
  PostDatedCheckSalesPersonDisplayValue?: string;
  PostDatedCheckStopPayment?: string;
  SettleVoucher?: string;
  TaxItemGroup?: string;
  ThirdPartyBankAccountId?: string;

  constructor(data: CashInFreightDFOLineBase) {
    Object.assign(this, data);
  }
}

export class CashInFreightDFOLine
  extends CashInFreightDFOLineBase
  implements DynDataModel
{
  /** Dimension model for MS dimension combination (not a D365 field). */
  DimensionModel: AccountDimensionsModel;

  SourceIds: string[] = [];

  private errors: Array<{ property: string; message: string }> = [];

  constructor(
    data: CashInFreightDFOLineBase,
    dimensionModel: AccountDimensionsModel,
  ) {
    super(data);
    this.DimensionModel = dimensionModel;
    this.SourceIds = [data.PaymentId];
  }

  get ErrorCount(): number {
    return this.errors.length;
  }

  get ErrorsText(): string {
    if (this.errors.length === 0) return '';
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}
