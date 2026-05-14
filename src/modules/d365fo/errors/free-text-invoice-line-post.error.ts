/**
 * Context for a failed single-line FreeTextInvoiceLines OData create.
 * Thrown from {@link FreeTextInvoiceService.postLinesBatch} so callers can persist which line failed.
 */
export interface FreeTextInvoiceLinePostContext {
  /** 0-based index in the full lines array for this invoice */
  lineIndexInInvoice: number;
  chunkNumber: number;
  /** 0-based index within the failing chunk */
  indexInChunk: number;
  parentRecId: number;
  lineNumber: number;
  dataAreaId: string;
  billingCode?: string;
  mainAccountDisplayValue?: string;
  invoiceText?: string;
  defaultDimensionDisplayValue?: string;
}

export class FreeTextInvoiceLinePostError extends Error {
  constructor(
    message: string,
    public readonly context: FreeTextInvoiceLinePostContext,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FreeTextInvoiceLinePostError';
  }
}
