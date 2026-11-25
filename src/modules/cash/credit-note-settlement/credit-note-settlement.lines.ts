import { EntryAccountType } from '@/common/types/entry-account.type';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import {
  sanitizeCashBankAccountDimension,
  toCashDefaultDimensionDisplayValue,
} from '@/modules/cash/policies/cash-dimension.policy';
import { createCashInboundDynamicLine } from '@/modules/cash/services/cash-in-line-building.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';

import {
  CREDIT_NOTE_SETTLEMENT_JOURNAL_BATCH,
  CREDIT_NOTE_SETTLEMENT_JOURNAL_NAME,
  CREDIT_NOTE_SETTLEMENT_SAFE_TYPE,
} from './credit-note-settlement.constants';
import { ReviewedSettlementPair } from './credit-note-settlement.review';

const dimensionUtils = new EntryProcessorUtilsService();

/**
 * Journal lines for the reviewed pairs. A valid pair gives two customer lines
 * with no offset: a debit that marks the credit note and a credit that marks the
 * invoice, for the same amount, so the voucher balances. A blocked pair gives
 * one line that carries its errors; the batch then holds errors and the standard
 * post refuses it.
 */
export function buildCreditNoteSettlementLines(
  pairs: ReviewedSettlementPair[],
  company: string,
  postingDate: string,
): CashEntryDynDataModel[] {
  const lines: CashEntryDynDataModel[] = [];
  for (const pair of pairs) {
    const { row } = pair;
    const dimensions = dimensionUtils.parseDimensionString(
      pair.defaultDimension,
    );
    sanitizeCashBankAccountDimension(dimensions);
    const dimensionDisplay = pair.defaultDimension
      ? toCashDefaultDimensionDisplayValue(dimensions, false)
      : '';
    const text = `Credit note ${row.creditNoteInvoice} settles ${row.originalInvoice}`;
    const base = (
      side: 'debit' | 'credit',
      markedInvoice: string,
    ): Partial<CashEntryDynDataModel> => ({
      SourceIds: [String(row.sourceRow)],
      SourceLineNumber: row.sourceRow,
      LineNumber: lines.length + 1,
      JournalBatchNumber: CREDIT_NOTE_SETTLEMENT_JOURNAL_BATCH,
      JournalName: CREDIT_NOTE_SETTLEMENT_JOURNAL_NAME,
      Description: text,
      TransactionText: text,
      Company: company,
      dataAreaId: company,
      AccountType: 'Cust' as EntryAccountType,
      AccountDisplayValue: row.customer,
      OffsetAccountType: '' as EntryAccountType,
      OffsetAccountDisplayValue: '',
      OffsetCompany: company,
      TransactionDate: postingDate,
      TransDate: postingDate,
      CurrencyCode: row.currency,
      DebitAmount: side === 'debit' ? pair.amount : 0,
      CreditAmount: side === 'credit' ? pair.amount : 0,
      DefaultDimensionsForAccountDisplayValue: dimensionDisplay,
      Invoice: markedInvoice,
      MarkedInvoice: markedInvoice,
      SettlementIntent: 'Marked',
      MarkedLines: [
        {
          InvoiceNumber: markedInvoice,
          OperationNumber: '',
          DocumentNumber: '',
          HasWithHoldingLine: false,
        },
      ],
      SafeType: CREDIT_NOTE_SETTLEMENT_SAFE_TYPE,
      PaymentReference: row.creditNoteInvoice,
    });

    if (pair.status !== 'VALID') {
      const line = createCashInboundDynamicLine(
        dimensions,
        base('debit', row.creditNoteInvoice),
      );
      for (const error of pair.errors) {
        line.AddError('CreditNoteSettlement', `Row ${row.sourceRow}: ${error}`);
      }
      lines.push(line);
      continue;
    }

    lines.push(
      createCashInboundDynamicLine(
        dimensions,
        base('debit', row.creditNoteInvoice),
      ),
    );
    lines.push(
      createCashInboundDynamicLine(
        dimensions,
        base('credit', row.originalInvoice),
      ),
    );
  }
  return lines;
}

/** Source rows stored with the batch (one per template row). */
export function creditNoteSettlementSourceRows(
  pairs: ReviewedSettlementPair[],
): Record<string, unknown>[] {
  return pairs.map(({ row }) => ({
    UniqueId: row.sourceRow,
    LINENUMBER: row.sourceRow,
    CreditNoteVoucher: row.creditNoteVoucher,
    CreditNoteInvoice: row.creditNoteInvoice,
    Customer: row.customer,
    CreditNoteAmount: row.creditNoteAmount,
    OriginalVoucher: row.originalVoucher,
    OriginalInvoice: row.originalInvoice,
    OriginalAmount: row.originalAmount,
    Currency: row.currency,
    SettleAmount: row.settleAmount,
    Notes: row.notes,
  }));
}
