import { EntrySafeType, EntryVoucherType } from '@/modules/cash/types';
import {
  EntryDimensionsModel,
  EntryDynDataModel,
} from '@/modules/entry-processor/models';

export interface CashEntryMarkedLine {
  InvoiceNumber: string;
  OperationNumber: string;
  DocumentNumber: string;
  HasWithHoldingLine: boolean;
  FullSettlement?: boolean;
}

export type CashSettlementIntent = 'Marked' | 'Unmarked' | 'None';

export class CashEntryDynDataModel extends EntryDynDataModel {
  /** Customer name */
  CustomerName: string;

  // AMOUNTS
  /** Currency Code */
  CurrencyCode: string;
  /** Credit Amount */
  CreditAmount: number;
  /** Debit Amount */
  DebitAmount: number;
  /** Exchange rate */
  ExchangeRate: number;
  /** Secondary exchange rate */
  SecondaryExchangeRate: number;

  /** Payment method */
  PaymentMethodName: string;
  /** Payment id */
  PaymentId: string;
  /** Payment reference */
  PaymentReference: string;

  /** Transaction text */
  TransactionText: string;

  /** Is withholding calculate */
  IsWithholdingCalculationEnabled: 'Yes' | 'No';

  /** Transaction date */
  TransactionDate: string;

  /** Default dimensions for account display value */
  DefaultDimensionsForAccountDisplayValue: string;
  /** Default dimensions for offset account display value */
  DefaultDimensionsForOffsetAccountDisplayValue: string;

  /** Marked invoice */
  MarkedInvoice: string;
  MarkedLines: CashEntryMarkedLine[];
  SettlementIntent: CashSettlementIntent;
  VendorGroup: string;

  /** Safe type */
  SafeType: EntrySafeType;
  /** Voucher type */
  VoucherType: EntryVoucherType;
  SettlementTargetType: 'VendorInvoice' | 'CustodyLedger' | 'None';
  /** Excel LINENUMBER. Survives cash-out journal reindexing of LineNumber. */
  SourceLineNumber?: number;
  /**
   * Set when D365 calculates this line's withholding natively instead of a
   * separate 223304 line. The invoice is then marked for the gross amount and
   * the withholding calculation is enabled on the resolved D365 line.
   */
  NativeWithholding?: {
    withholdingGroup: string;
    grossAmount: number;
    withholdingAmount: number;
  };
  /** Why the explicit 223304 entry was kept when native was requested. */
  WithholdingFallbackReason?: string;

  constructor(
    dimensionModel: EntryDimensionsModel,
    data: Partial<CashEntryDynDataModel>,
  ) {
    super(data, dimensionModel);

    this.CustomerName = data.CustomerName || '';
    this.CurrencyCode = data.CurrencyCode || '';
    this.CreditAmount = data.CreditAmount || 0;
    this.DebitAmount = data.DebitAmount || 0;
    this.ExchangeRate = data.ExchangeRate || 0;
    this.SecondaryExchangeRate = data.SecondaryExchangeRate || 0;
    this.PaymentMethodName = data.PaymentMethodName || '';
    this.PaymentId = data.PaymentId || '';
    this.PaymentReference = data.PaymentReference || '';
    this.IsWithholdingCalculationEnabled =
      data.IsWithholdingCalculationEnabled || 'No';
    this.TransactionText = data.TransactionText || '';
    this.TransactionDate = data.TransactionDate || '';
    this.DefaultDimensionsForAccountDisplayValue =
      data.DefaultDimensionsForAccountDisplayValue || '';
    this.DefaultDimensionsForOffsetAccountDisplayValue =
      data.DefaultDimensionsForOffsetAccountDisplayValue || '';
    this.MarkedInvoice = data.MarkedInvoice || '';
    this.MarkedLines = data.MarkedLines || [];
    this.SettlementIntent = data.SettlementIntent || 'None';
    this.VendorGroup = data.VendorGroup || '';
    this.SafeType = data.SafeType || ('' as EntrySafeType);
    this.VoucherType = data.VoucherType || ('' as EntryVoucherType);
    this.SettlementTargetType = data.SettlementTargetType || 'None';
    this.SourceLineNumber =
      Number(data.SourceLineNumber) > 0
        ? Number(data.SourceLineNumber)
        : undefined;
  }
}
