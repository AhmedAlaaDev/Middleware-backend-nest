import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants/entry-processor-names.constant';
import {
  SHIPLINK_TEMPLATE_MAX_DATA_ROWS,
  YARD_INVOICE_LIMITS,
} from './yard-invoice.constants';

/**
 * Invoice-driven review flows. Yard and ShipLink use the same review, D365
 * checks, consolidation, batch, re-check and settlement. Only the cash-in
 * processor, the receipt text in D365 and the voucher number setting differ.
 */
export type InvoiceReviewFlow = 'YARD' | 'SHIPLINK';

export interface InvoiceReviewFlowConfig {
  flow: InvoiceReviewFlow;
  label: string;
  processorType: EntryProcessorTypes;
  processorName: string;
  voucherLogicalName: string;
  /** Largest eight-column template accepted for this flow, in data rows. */
  maxTemplateRows: number;
  /** Prefix of a credit note line text: "<prefix><credit note number>". */
  creditNotePrefix: string;
  /** Prefix of the receipt text: "<prefix><invoice>" in DESCRIPTION and TransactionText. */
  receiptPrefix: string;
}

export const INVOICE_REVIEW_FLOWS: Record<
  InvoiceReviewFlow,
  InvoiceReviewFlowConfig
> = {
  YARD: {
    flow: 'YARD',
    label: 'Yard',
    processorType: EntryProcessorTypes.CashInYard,
    processorName: ENTRY_PROCESSOR_NAMES.CASH_IN_YARD,
    voucherLogicalName: 'last.ledger.voucher.cash.in.yard',
    maxTemplateRows: YARD_INVOICE_LIMITS.maxDataRows,
    receiptPrefix: 'Yard receipt ',
    creditNotePrefix: 'Yard credit note ',
  },
  SHIPLINK: {
    flow: 'SHIPLINK',
    label: 'ShipLink',
    processorType: EntryProcessorTypes.CashInShiplink,
    processorName: ENTRY_PROCESSOR_NAMES.CASH_IN_SHIPLINK,
    voucherLogicalName: 'last.ledger.voucher.cash.in.shiplink',
    maxTemplateRows: SHIPLINK_TEMPLATE_MAX_DATA_ROWS,
    receiptPrefix: 'ShipLink receipt ',
    creditNotePrefix: 'ShipLink credit note ',
  },
};

/** Receipt prefix for a batch that came from an invoice review flow, else null. */
export function invoiceReviewFlowOfBatch(batch: {
  entryProcessorType: EntryProcessorTypes;
  invoiceReviewFlow?: string | null;
}): InvoiceReviewFlowConfig | null {
  if (batch.entryProcessorType === EntryProcessorTypes.CashInYard) {
    return INVOICE_REVIEW_FLOWS.YARD;
  }
  if (
    batch.entryProcessorType === EntryProcessorTypes.CashInShiplink &&
    batch.invoiceReviewFlow === 'SHIPLINK'
  ) {
    return INVOICE_REVIEW_FLOWS.SHIPLINK;
  }
  return null;
}

/** Receipt prefix to strip or match on a stored line, across both flows. */
export const RECEIPT_PREFIXES = [
  INVOICE_REVIEW_FLOWS.YARD.receiptPrefix,
  INVOICE_REVIEW_FLOWS.SHIPLINK.receiptPrefix,
];

/** Credit note line prefixes across both flows. */
export const CREDIT_NOTE_PREFIXES = [
  INVOICE_REVIEW_FLOWS.YARD.creditNotePrefix,
  INVOICE_REVIEW_FLOWS.SHIPLINK.creditNotePrefix,
];

/**
 * Yard credit notes (-CN rows with negative amounts) are posted as customer
 * debit lines against the safe and settled to the credit note, instead of
 * blocking the file. Off unless YARD_CREDIT_NOTES_ENABLED is true, 1 or yes.
 */
export function isYardCreditNotesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = String(env.YARD_CREDIT_NOTES_ENABLED ?? '')
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export function isShiplinkInvoiceUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = String(env.SHIPLINK_INVOICE_UPLOAD_ENABLED ?? '')
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}
