import { EntryAccountType } from '@/common/types/entry-account.type';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

/**
 * Mapped (dyn) line after format/enrich. Shared properties across
 * cash-in DFO, cash-out DFO, vendor DFO, DynAccountReceivableLineDto,
 * DynLedgerClosingJournalEntryDto, and DynCustodySettlementJournalEntryDto.
 * Naming: PascalCase.
 */
export class EntryDynDataModel {
  // SOURCE IDENTIFIERS
  SourceIds: string[] = [];

  // CORE IDENTIFIERS
  /** Data area id (e.g. company) */
  dataAreaId: string;
  /** Journal batch number */
  JournalBatchNumber: string;
  /** Line number within batch/journal */
  LineNumber: number;
  /** Voucher number */
  Voucher: string;
  /** Invoice */
  Invoice: string;

  // ACCOUNTS
  /** Account type */
  AccountType: EntryAccountType;
  /** Offset account type */
  OffsetAccountType: EntryAccountType;
  /** Account display value */
  AccountDisplayValue: string;
  /** Offset account display value */
  OffsetAccountDisplayValue: string;
  /** Posting profile */
  PostingProfile: string;

  // DIMENSIONS
  /** Default dimension display value */
  DefaultDimensionDisplayValue: string;
  /** Offset default dimension display value */
  OffsetDefaultDimensionDisplayValue: string;
  /** Fin tag display value */
  FinTagDisplayValue: string;
  /** Offset fin tag display value */
  OffsetFinTagDisplayValue: string;

  // EXCHANGE RATES
  /** Exchange rate */
  ExchRate: number;
  /** Secondary exchange rate */
  ExchRateSecond: number;
  /** Reporting currency exchange rate */
  ReportingCurrencyExchRate: number;
  /** Reporting currency exchange rate secondary */
  ReportingCurrencyExchRateSecondary: number;

  // DATES
  /** Due date */
  DueDate: string;
  /** Document date */
  DocumentDate: string;
  /** Invoice date */
  InvoiceDate: string;
  /** Transaction date */
  TransDate: string;
  /** Date */
  Date: string;

  // HEADER HELPER LINES
  /** Journal name */
  JournalName: string;
  /** Description */
  Description: string;
  /** Company */
  Company: string;
  /** Offset company */
  OffsetCompany: string;

  // TEXT FIELDS
  /** Document */
  Document: string;
  /** Text */
  Text: string;
  /** Offset text */
  OffsetText: string;
  /** Offset transaction text */
  OffsetTransactionText: string;

  // TAXES
  /** Sales tax group */
  SalesTaxGroup: string;
  /** Item sales tax group */
  ItemSalesTaxGroup: string;
  /** Sales tax code */
  SalesTaxCode: string;
  /** Tax exempt number */
  TaxExemptNumber: string;
  /** Item withholding tax group code */
  ItemWithholdingTaxGroupCode: string;

  // DISCOUNTS
  /** Cash discount */
  CashDiscount: string;
  /** Cash discount amount */
  CashDiscountAmount: number;
  /** Cash discount date */
  CashDiscountDate: string;

  /** Dimension model for validation/posting */
  DimensionModel: EntryDimensionsModel;

  private errors: Array<{ property: string; message: string }> = [];

  constructor(
    data: Partial<EntryDynDataModel>,
    dimensionModel: EntryDimensionsModel,
  ) {
    // SOURCE IDENTIFIERS
    this.SourceIds = data.SourceIds || [];

    // CORE IDENTIFIERS
    this.dataAreaId = data.dataAreaId || '';
    this.JournalBatchNumber = data.JournalBatchNumber || '';
    this.LineNumber = data.LineNumber || 0;
    this.Voucher = data.Voucher || '';
    this.Invoice = data.Invoice || '';

    // ACCOUNTS
    this.AccountType = data.AccountType || ('' as EntryAccountType);
    this.OffsetAccountType = data.OffsetAccountType || ('' as EntryAccountType);
    this.AccountDisplayValue = data.AccountDisplayValue || '';
    this.OffsetAccountDisplayValue = data.OffsetAccountDisplayValue || '';
    this.PostingProfile = data.PostingProfile || '';

    // DIMENSIONS
    this.DefaultDimensionDisplayValue = data.DefaultDimensionDisplayValue || '';
    this.OffsetDefaultDimensionDisplayValue =
      data.OffsetDefaultDimensionDisplayValue || '';
    this.FinTagDisplayValue = data.FinTagDisplayValue || '';
    this.OffsetFinTagDisplayValue = data.OffsetFinTagDisplayValue || '';

    // EXCHANGE RATES
    this.ExchRate = data.ExchRate || 0;
    this.ExchRateSecond = data.ExchRateSecond || 0;
    this.ReportingCurrencyExchRate = data.ReportingCurrencyExchRate || 0;
    this.ReportingCurrencyExchRateSecondary =
      data.ReportingCurrencyExchRateSecondary || 0;

    // DATES
    this.DueDate = data.DueDate || '';
    this.DocumentDate = data.DocumentDate || '';
    this.InvoiceDate = data.InvoiceDate || '';
    this.TransDate = data.TransDate || '';
    this.Date = data.Date || '';

    // HEADER HELPER LINES
    this.JournalName = data.JournalName || '';
    this.Description = data.Description || '';
    this.Company = data.Company || '';
    this.OffsetCompany = data.OffsetCompany || '';

    // TEXT FIELDS
    this.Document = data.Document || '';
    this.Text = data.Text || '';
    this.OffsetText = data.OffsetText || '';
    this.OffsetTransactionText = data.OffsetTransactionText || '';

    // TAXES
    this.SalesTaxGroup = data.SalesTaxGroup || '';
    this.ItemSalesTaxGroup = data.ItemSalesTaxGroup || '';
    this.SalesTaxCode = data.SalesTaxCode || '';
    this.TaxExemptNumber = data.TaxExemptNumber || '';
    this.ItemWithholdingTaxGroupCode = data.ItemWithholdingTaxGroupCode || '';

    // DISCOUNTS
    this.CashDiscount = data.CashDiscount || '';
    this.CashDiscountAmount = data.CashDiscountAmount || 0;
    this.CashDiscountDate = data.CashDiscountDate || '';

    // DIMENSION MODEL
    this.DimensionModel = dimensionModel;
  }

  public get ErrorCount(): number {
    return this.errors.length;
  }

  public get ErrorsText(): string {
    if (this.errors.length === 0) return '';
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  public AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  public GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}
