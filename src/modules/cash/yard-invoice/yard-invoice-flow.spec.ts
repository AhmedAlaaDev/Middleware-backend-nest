import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

import {
  INVOICE_REVIEW_FLOWS,
  invoiceReviewFlowOfBatch,
  isShiplinkInvoiceUploadEnabled,
} from './yard-invoice-flow';
import {
  isYardReceiptLine,
  yardInvoiceOf,
  YardJournalLine,
} from './yard-invoice-settlement.service';
import { yardBatchRowFromStoredRecord } from './yard-invoice-posting-recheck';

function journalLine(text: string): YardJournalLine {
  return {
    LineNumber: 1,
    TransactionText: text,
    AccountDisplayValue: 'CUST-01',
    CreditAmount: 100,
    DebitAmount: 0,
    CurrencyCode: 'EGP',
  } as unknown as YardJournalLine;
}

describe('invoice review flows', () => {
  it('treats a Yard batch as a review batch', () => {
    expect(
      invoiceReviewFlowOfBatch({
        entryProcessorType: EntryProcessorTypes.CashInYard,
      }),
    ).toBe(INVOICE_REVIEW_FLOWS.YARD);
  });

  it('treats a ShipLink batch as a review batch only when the review created it', () => {
    expect(
      invoiceReviewFlowOfBatch({
        entryProcessorType: EntryProcessorTypes.CashInShiplink,
        invoiceReviewFlow: 'SHIPLINK',
      }),
    ).toBe(INVOICE_REVIEW_FLOWS.SHIPLINK);
    expect(
      invoiceReviewFlowOfBatch({
        entryProcessorType: EntryProcessorTypes.CashInShiplink,
      }),
    ).toBeNull();
  });

  it('gives ShipLink its own receipt prefix and voucher setting', () => {
    expect(INVOICE_REVIEW_FLOWS.SHIPLINK.receiptPrefix).toBe(
      'ShipLink receipt ',
    );
    expect(INVOICE_REVIEW_FLOWS.SHIPLINK.voucherLogicalName).toBe(
      'last.ledger.voucher.cash.in.shiplink',
    );
  });

  it('turns the ShipLink upload on only for true, 1 or yes', () => {
    expect(
      isShiplinkInvoiceUploadEnabled({
        SHIPLINK_INVOICE_UPLOAD_ENABLED: 'yes',
      }),
    ).toBe(true);
    expect(
      isShiplinkInvoiceUploadEnabled({
        SHIPLINK_INVOICE_UPLOAD_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(isShiplinkInvoiceUploadEnabled({})).toBe(false);
  });
});

describe('ShipLink receipts in settlement and re-check', () => {
  it('recognises a ShipLink receipt line and reads its invoice', () => {
    const line = journalLine('ShipLink receipt 000061183/YD');
    expect(isYardReceiptLine(line)).toBe(true);
    expect(yardInvoiceOf(line)).toBe('000061183/YD');
  });

  it('still recognises a Yard receipt line', () => {
    const line = journalLine('Yard receipt 000061183/YD');
    expect(isYardReceiptLine(line)).toBe(true);
    expect(yardInvoiceOf(line)).toBe('000061183/YD');
  });

  it('ignores a line that is neither', () => {
    expect(isYardReceiptLine(journalLine('Customer refund'))).toBe(false);
  });

  it('reads the invoice from a ShipLink description in the re-check', () => {
    const { row } = yardBatchRowFromStoredRecord({
      Description: 'ShipLink receipt 000061183/YD',
    });
    expect(row.invoiceNumber).toBe('000061183/YD');
  });
});
