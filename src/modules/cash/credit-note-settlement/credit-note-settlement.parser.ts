import ExcelJS from 'exceljs';

import { cellText } from '@/modules/cash/yard-invoice/yard-invoice-template.parser';

import {
  CREDIT_NOTE_SETTLEMENT_HEADERS,
  CREDIT_NOTE_SETTLEMENT_LIMITS,
  CREDIT_NOTE_SETTLEMENT_SHEET,
} from './credit-note-settlement.constants';

/** One template row: a credit note and the invoice it reverses. */
export interface CreditNoteSettlementRow {
  /** 1-based Excel row number. */
  sourceRow: number;
  creditNoteVoucher: string;
  creditNoteInvoice: string;
  customer: string;
  creditNoteAmount: number | null;
  originalVoucher: string;
  originalInvoice: string;
  originalAmount: number | null;
  currency: string;
  settleAmount: number | null;
  notes: string;
  /** Problems found in the row itself, before any D365 read. */
  errors: string[];
}

export interface CreditNoteSettlementParseResult {
  rows: CreditNoteSettlementRow[];
}

/** File-level problem: the workbook cannot be read as a settlement template. */
export class CreditNoteSettlementTemplateError extends Error {}

/**
 * Reads the "Settlement" sheet of the credit note settlement template. Other
 * sheets (for example "How to fill") are ignored. Headers must match exactly and
 * in order. Row problems are returned on the row; file problems throw.
 */
export async function parseCreditNoteSettlementWorkbook(
  buffer: Buffer<ArrayBufferLike>,
): Promise<CreditNoteSettlementParseResult> {
  if (buffer.length > CREDIT_NOTE_SETTLEMENT_LIMITS.maxFileBytes) {
    throw new CreditNoteSettlementTemplateError(
      `file exceeds the ${CREDIT_NOTE_SETTLEMENT_LIMITS.maxFileBytes} byte limit`,
    );
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new CreditNoteSettlementTemplateError(
      'file could not be read as an .xlsx workbook',
    );
  }

  const sheet = workbook.getWorksheet(CREDIT_NOTE_SETTLEMENT_SHEET);
  if (!sheet) {
    throw new CreditNoteSettlementTemplateError(
      `the workbook has no sheet named "${CREDIT_NOTE_SETTLEMENT_SHEET}"; use the credit note settlement template`,
    );
  }

  const expected = [...CREDIT_NOTE_SETTLEMENT_HEADERS];
  const headerRow = sheet.getRow(1);
  const headers = expected.map((_, index) =>
    cellText(headerRow.getCell(index + 1).value).trim(),
  );
  if (!expected.every((header, index) => headers[index] === header)) {
    throw new CreditNoteSettlementTemplateError(
      `headers must be exactly, in order: ${expected.join(', ')}; found: ${headers.join(', ') || '(none)'}`,
    );
  }

  const rows: CreditNoteSettlementRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber++) {
    const excelRow = sheet.getRow(rowNumber);
    const text = (index: number) =>
      cellText(excelRow.getCell(index + 1).value).trim();
    const values = expected.map((_, index) => text(index));
    if (values.every((value) => value === '')) continue;

    if (rows.length >= CREDIT_NOTE_SETTLEMENT_LIMITS.maxPairs) {
      throw new CreditNoteSettlementTemplateError(
        `template exceeds the ${CREDIT_NOTE_SETTLEMENT_LIMITS.maxPairs} pair limit`,
      );
    }
    rows.push(parseRow(rowNumber, values));
  }

  if (rows.length === 0) {
    throw new CreditNoteSettlementTemplateError(
      'the Settlement sheet has no rows to settle',
    );
  }
  return { rows };
}

function parseRow(
  sourceRow: number,
  values: string[],
): CreditNoteSettlementRow {
  const [
    creditNoteVoucher,
    creditNoteInvoice,
    customer,
    creditNoteAmountText,
    originalVoucher,
    originalInvoice,
    originalAmountText,
    currencyText,
    settleAmountText,
    notes,
  ] = values;
  const errors: string[] = [];
  const required: Array<[string, string]> = [
    ['CreditNoteInvoice', creditNoteInvoice],
    ['Customer', customer],
    ['OriginalInvoice', originalInvoice],
    ['Currency', currencyText],
    ['SettleAmount', settleAmountText],
  ];
  for (const [column, value] of required) {
    if (!value) errors.push(`${column} is required`);
  }
  if (
    creditNoteInvoice &&
    originalInvoice &&
    creditNoteInvoice === originalInvoice
  ) {
    errors.push('CreditNoteInvoice and OriginalInvoice must be different');
  }

  const creditNoteAmount = optionalAmount(
    'CreditNoteAmount',
    creditNoteAmountText,
    errors,
  );
  const originalAmount = optionalAmount(
    'OriginalAmount',
    originalAmountText,
    errors,
  );
  const settleAmount = optionalAmount('SettleAmount', settleAmountText, errors);
  if (settleAmount !== null && !(settleAmount > 0)) {
    errors.push('SettleAmount must be a positive amount');
  }

  return {
    sourceRow,
    creditNoteVoucher,
    creditNoteInvoice,
    customer,
    creditNoteAmount,
    originalVoucher,
    originalInvoice,
    originalAmount,
    currency: currencyText.toUpperCase(),
    settleAmount,
    notes,
    errors,
  };
}

function optionalAmount(
  column: string,
  text: string,
  errors: string[],
): number | null {
  if (!text) return null;
  const value = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    errors.push(`${column} must be a number`);
    return null;
  }
  return Math.round(value * 100) / 100;
}
