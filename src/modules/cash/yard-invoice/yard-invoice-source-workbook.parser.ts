import ExcelJS from 'exceljs';

import {
  assertWithinLimit,
  numericValueToMicro,
  parseDecimalToMicro,
  Micro,
  YardInvoiceDecimalError,
} from './yard-invoice-decimal';
import {
  isCreditNoteInvoice,
  YardPaymentRecord,
  YardRecordIssue,
} from './yard-invoice-record';
import {
  hasControlCharacters,
  cellText,
  parseDateCell,
} from './yard-invoice-template.parser';
import { YARD_INVOICE_PAYMENT_TYPES } from './yard-invoice.constants';

import { CASH_PAYMENT_REFERENCE_MAX_LENGTH } from '@/modules/cash/policies/cash-payment-reference.policy';

/**
 * Accepted Yards source layouts. A worksheet is accepted only when its row-1
 * headers equal one of these sequences exactly. The header text is never
 * fuzzily matched. Each layout maps its columns to the common model by header
 * name, so the same header means the same thing in every layout that has it.
 */
export const YARDS_SOURCE_MAX_ROWS = 25_000;

const COMMON_TAIL = [
  'FREETEXTNUMBER',
  'DEFAULTDIMENSIONDISPLAYVALUE',
  'HEADERFINTAGDISPLAYVALUE',
  'CUSTOMERACCOUNT',
] as const;

export interface YardsSourceLayout {
  id: string;
  headers: readonly string[];
  /** Header name for each common role, exactly as it appears in the layout. */
  roles: {
    date: string;
    paymentType: string;
    amount: string;
    currency: string;
    safe: string;
    customerName?: string;
    reference?: string;
  };
}

export const YARDS_SOURCE_LAYOUTS: readonly YardsSourceLayout[] = [
  {
    id: 'YARDS_LAYOUT_IST',
    headers: [
      'Payment Date',
      'Payment Type',
      'Customer',
      'Net Total',
      'Currency',
      'SAFE_BankAccount',
      ...COMMON_TAIL,
    ],
    roles: {
      date: 'Payment Date',
      paymentType: 'Payment Type',
      amount: 'Net Total',
      currency: 'Currency',
      safe: 'SAFE_BankAccount',
      customerName: 'Customer',
    },
  },
  {
    id: 'YARDS_LAYOUT_CUR_SAFE',
    headers: [
      'Payment Date',
      'Payment Type',
      'Net Total',
      'Cur',
      'safe',
      ...COMMON_TAIL,
    ],
    roles: {
      date: 'Payment Date',
      paymentType: 'Payment Type',
      amount: 'Net Total',
      currency: 'Cur',
      safe: 'safe',
    },
  },
  {
    id: 'YARDS_LAYOUT_REMARK',
    headers: [
      'Payment Date',
      'Payment Type',
      'Payment Rmrk',
      'Net Total',
      'Cur',
      'SAFE',
      ...COMMON_TAIL,
    ],
    roles: {
      date: 'Payment Date',
      paymentType: 'Payment Type',
      amount: 'Net Total',
      currency: 'Cur',
      safe: 'SAFE',
      reference: 'Payment Rmrk',
    },
  },
];

export interface YardsSheetSummary {
  sourceSheet: string;
  layoutId: string;
  /** Rows with at least one value (blank rows are skipped and not counted). */
  contentRows: number;
  acceptedRecords: number;
  issueCount: number;
}

export interface YardsSourceParseResult {
  format: 'YARDS_SOURCE';
  sheets: YardsSheetSummary[];
  records: YardPaymentRecord[];
  issues: YardRecordIssue[];
}

export class YardsSourceLayoutError extends Error {}

/** Returns the layout whose headers equal the sheet's row 1 exactly, or null. */
export function matchYardsSourceLayout(
  headers: string[],
): YardsSourceLayout | null {
  return (
    YARDS_SOURCE_LAYOUTS.find(
      (layout) =>
        layout.headers.length === headers.length &&
        layout.headers.every((header, index) => header === headers[index]),
    ) ?? null
  );
}

export function readRowOneHeaders(sheet: ExcelJS.Worksheet): string[] {
  const row = sheet.getRow(1);
  const count = Math.max(
    sheet.columnCount,
    ...YARDS_SOURCE_LAYOUTS.map((l) => l.headers.length),
  );
  const headers: string[] = [];
  for (let column = 1; column <= count; column++) {
    headers.push(cellText(row.getCell(column).value).trim());
  }
  // Trailing blank header cells are not part of any layout.
  while (headers.length > 0 && headers[headers.length - 1] === '') {
    headers.pop();
  }
  return headers;
}

/**
 * Parses an already-loaded Yards source workbook. The caller has checked that
 * every worksheet matches a layout. Structural failures throw; row problems are
 * returned as issues with sheet name and row number.
 */
export function parseYardsSourceWorkbook(
  workbook: ExcelJS.Workbook,
): YardsSourceParseResult {
  const sheets: YardsSheetSummary[] = [];
  const records: YardPaymentRecord[] = [];
  const issues: YardRecordIssue[] = [];
  let totalRows = 0;

  for (const sheet of workbook.worksheets) {
    const layout = matchYardsSourceLayout(readRowOneHeaders(sheet));
    if (!layout) {
      throw new YardsSourceLayoutError(
        `sheet "${sheet.name}" does not match a known Yards source layout (headers must match exactly)`,
      );
    }
    const indexOf = (header: string) => {
      const index = layout.headers.indexOf(header);
      if (index < 0)
        throw new Error(`layout ${layout.id} lacks header ${header}`);
      return index + 1;
    };
    const col = {
      date: indexOf(layout.roles.date),
      paymentType: indexOf(layout.roles.paymentType),
      amount: indexOf(layout.roles.amount),
      currency: indexOf(layout.roles.currency),
      safe: indexOf(layout.roles.safe),
      invoice: indexOf('FREETEXTNUMBER'),
      dimension: indexOf('DEFAULTDIMENSIONDISPLAYVALUE'),
      tag: indexOf('HEADERFINTAGDISPLAYVALUE'),
      customerAccount: indexOf('CUSTOMERACCOUNT'),
      customerName: layout.roles.customerName
        ? indexOf(layout.roles.customerName)
        : null,
      reference: layout.roles.reference
        ? indexOf(layout.roles.reference)
        : null,
    };

    let contentRows = 0;
    let accepted = 0;
    let sheetIssues = 0;
    const lastRow = sheet.actualRowCount;

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const valueAt = (index: number | null) =>
        index === null ? undefined : row.getCell(index).value;
      const width = layout.headers.length;
      const values = Array.from(
        { length: width },
        (_, i) => row.getCell(i + 1).value,
      );
      if (values.every((value) => cellText(value).trim() === '')) continue;

      contentRows++;
      totalRows++;
      if (totalRows > YARDS_SOURCE_MAX_ROWS) {
        throw new YardsSourceLayoutError(
          `workbook exceeds the ${YARDS_SOURCE_MAX_ROWS} data row limit`,
        );
      }

      const rowIssues: YardRecordIssue[] = [];
      const fail = (column: string, message: string) =>
        rowIssues.push({
          sourceSheet: sheet.name,
          sourceRow: rowNumber,
          column,
          message,
        });

      const invoiceRaw = valueAt(col.invoice);
      const invoiceNumber = textValue(invoiceRaw, 'FREETEXTNUMBER', fail, 60);

      const paymentDate = parseDateCell(valueAt(col.date));
      if (!paymentDate) fail(layout.roles.date, 'use a real date (dd-mm-yyyy)');

      const rawType = cellText(valueAt(col.paymentType)).trim();
      const paymentType = YARD_INVOICE_PAYMENT_TYPES[rawType.toLowerCase()];
      if (!paymentType) {
        fail(layout.roles.paymentType, `unsupported payment type "${rawType}"`);
      }

      const currencyCode = cellText(valueAt(col.currency)).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currencyCode)) {
        fail(layout.roles.currency, 'currency must be a 3-letter ISO code');
      }

      const safeBankAccount = textValue(
        valueAt(col.safe),
        layout.roles.safe,
        fail,
        100,
        true,
      );

      let amount: Micro | null = null;
      const amountCell = valueAt(col.amount);
      const amountText = cellText(amountCell).trim();
      try {
        amount =
          typeof amountCell === 'number'
            ? numericValueToMicro(amountCell)
            : parseDecimalToMicro(amountText);
        assertWithinLimit(amount);
        if (amount === 0n) fail(layout.roles.amount, 'amount is zero');
      } catch (error) {
        if (error instanceof YardInvoiceDecimalError) {
          fail(layout.roles.amount, error.message);
        } else {
          throw error;
        }
      }

      const isCreditNote = invoiceNumber
        ? isCreditNoteInvoice(invoiceNumber)
        : false;
      if (amount !== null && amount < 0n && !isCreditNote) {
        fail(
          layout.roles.amount,
          'negative amount on an invoice without the -CN suffix',
        );
      }

      const customerAccount = textValue(
        valueAt(col.customerAccount),
        'CUSTOMERACCOUNT',
        fail,
        60,
        true,
      );
      const dimension = textValue(
        valueAt(col.dimension),
        'DEFAULTDIMENSIONDISPLAYVALUE',
        fail,
        500,
        true,
      );
      const tag = textValue(
        valueAt(col.tag),
        'HEADERFINTAGDISPLAYVALUE',
        fail,
        500,
        true,
      );
      const customerName =
        col.customerName === null
          ? null
          : cellText(valueAt(col.customerName)).trim() || null;
      const reference =
        col.reference === null ? '' : cellText(valueAt(col.reference)).trim();
      if (reference.length > CASH_PAYMENT_REFERENCE_MAX_LENGTH) {
        fail(
          layout.roles.reference ?? 'Payment Rmrk',
          `payment remark is ${reference.length} characters; the D365 payment reference limit is ${CASH_PAYMENT_REFERENCE_MAX_LENGTH}. It is not truncated.`,
        );
      }
      if (hasControlCharacters(reference)) {
        fail(
          layout.roles.reference ?? 'Payment Rmrk',
          'payment remark contains control characters',
        );
      }

      if (rowIssues.length > 0) {
        issues.push(...rowIssues);
        sheetIssues += rowIssues.length;
        continue;
      }

      accepted++;
      records.push({
        format: 'YARDS_SOURCE',
        sourceSheet: sheet.name,
        layoutId: layout.id,
        sourceRow: rowNumber,
        paymentSerial: null,
        paymentDate: paymentDate as string,
        paymentType: paymentType,
        rawPaymentType: rawType,
        amount: amount as Micro,
        amountText,
        currencyCode,
        paymentReference: reference,
        safeBankAccount,
        invoiceNumber,
        workbookCustomerAccount: customerAccount,
        workbookCustomerName: customerName,
        workbookDimension: dimension,
        workbookFinTag: tag,
        isCreditNote,
      });
    }

    sheets.push({
      sourceSheet: sheet.name,
      layoutId: layout.id,
      contentRows,
      acceptedRecords: accepted,
      issueCount: sheetIssues,
    });
  }

  return { format: 'YARDS_SOURCE', sheets, records, issues };
}

/** Text value with no numeric coercion. Numbers are refused for identifiers. */
function textValue(
  value: unknown,
  column: string,
  fail: (column: string, message: string) => void,
  max: number,
  required = true,
): string {
  if (typeof value === 'number' || typeof value === 'bigint') {
    fail(
      column,
      'must be stored as text; a numeric cell can lose leading zeros',
    );
    return '';
  }
  const text = cellText(value).trim();
  if (!text) {
    if (required) fail(column, 'value is required');
    return '';
  }
  if (text.length > max) fail(column, `longer than ${max} characters`);
  if (hasControlCharacters(text)) fail(column, 'contains control characters');
  return text;
}
