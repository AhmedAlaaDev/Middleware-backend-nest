import { Micro } from './yard-invoice-decimal';

/**
 * Resolution of one template InvoiceNumber to the posted D365 invoice and its
 * posted accounting lines. Every field here comes from a D365 read; none is
 * taken from the uploaded workbook.
 */
export interface YardInvoiceMetadata {
  invoiceNumber: string;
  company: string;
  /** FreeTextInvoiceHeaders.InvoiceIdentifier (header record id). */
  invoiceIdentifier: string;
  /** FreeTextInvoiceHeaders.CustomerAccount. */
  customerAccount: string;
  /** FreeTextInvoiceHeaders.CurrencyCode, cross-checked to CustTrans. */
  currencyCode: string;
  /** FreeTextInvoiceHeaders.DefaultDimensionDisplayValue. */
  defaultDimensionDisplayValue: string;
  /** FinTagBiEntities.DisplayValue of the posted receivable line's tag. */
  financialTagDisplayValue: string;
  /** CustTransBiEntities.Voucher of the posted invoice transaction. */
  voucher: string;
  /** AmountCur less |SettleAmountCur|; null when not readable. */
  openBalance: Micro | null;
}

export type YardInvoiceLookupStatus =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'NOT_POSTED'
  | 'AMBIGUOUS'
  | 'MISSING_DIMENSION'
  | 'MISSING_TAG'
  | 'CUSTOMER_MISMATCH'
  | 'CLOSED'
  | 'LOOKUP_FAILED';

export type YardInvoiceLookupResult =
  | {
      status: 'FOUND';
      metadata: YardInvoiceMetadata;
    }
  | {
      status: Exclude<YardInvoiceLookupStatus, 'FOUND'>;
      invoiceNumber: string;
      message: string;
      /** true only for transient read failures; a retry is safe. */
      retryable: boolean;
    };
