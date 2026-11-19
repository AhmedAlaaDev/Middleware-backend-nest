import ExcelJS from 'exceljs';

import {
  assertSafeXlsxArchive,
  YardInvoiceArchiveError,
} from './yard-invoice-archive-guard';
import {
  YardPaymentRecord,
  YardRecordIssue,
  YardUploadFormat,
} from './yard-invoice-record';
import {
  matchYardsSourceLayout,
  parseYardsSourceWorkbook,
  YardsSourceLayoutError,
  readRowOneHeaders,
  YARDS_SOURCE_LAYOUTS,
  YardsSheetSummary,
} from './yard-invoice-source-workbook.parser';
import {
  parseYardInvoiceTemplate,
  YardInvoiceTemplateError,
} from './yard-invoice-template.parser';
import { YARD_INVOICE_TEMPLATE_SHEET } from './yard-invoice.constants';

export interface YardWorkbookParseResult {
  format: YardUploadFormat;
  /** Human label shown in the review, so the two formats are never confused. */
  formatLabel: string;
  sheets: YardsSheetSummary[];
  records: YardPaymentRecord[];
  issues: YardRecordIssue[];
}

export const YARD_FORMAT_LABELS: Record<YardUploadFormat, string> = {
  TEMPLATE_8:
    'Yards-Shiplink-Template (eight-column template: serial, reference, invoice; customer and dimensions come from D365)',
  YARDS_SOURCE:
    'Yards source workbook (per-sheet layouts; the workbook carries customer, dimension and tag values to compare with D365)',
};

/**
 * Detects the upload format and parses it into the common Yard payment model.
 *   - Exactly one sheet named "Template": the eight-column template.
 *   - Otherwise every sheet must match one of the Yards source layouts.
 * Anything else is refused with the list of accepted formats.
 */
export async function parseYardWorkbook(
  buffer: Buffer<ArrayBufferLike>,
  options: { maxTemplateRows?: number } = {},
): Promise<YardWorkbookParseResult> {
  try {
    assertSafeXlsxArchive(buffer);
  } catch (error) {
    if (error instanceof YardInvoiceArchiveError) {
      throw new YardInvoiceTemplateError(error.message);
    }
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new YardInvoiceTemplateError(
      'file could not be read as an .xlsx workbook',
    );
  }

  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  if (
    workbook.worksheets.length === 1 &&
    sheetNames[0] === YARD_INVOICE_TEMPLATE_SHEET
  ) {
    const template = await parseYardInvoiceTemplate(buffer, {
      maxDataRows: options.maxTemplateRows,
    });
    return {
      format: 'TEMPLATE_8',
      formatLabel: YARD_FORMAT_LABELS.TEMPLATE_8,
      sheets: [
        {
          sourceSheet: template.sheetName,
          layoutId: 'TEMPLATE_8',
          contentRows: template.contentRowCount,
          acceptedRecords: template.rows.length,
          issueCount: template.issues.length,
        },
      ],
      records: template.rows.map((row) => ({
        format: 'TEMPLATE_8' as const,
        sourceSheet: template.sheetName,
        layoutId: 'TEMPLATE_8',
        sourceRow: row.sourceRow,
        paymentSerial: row.paymentSerial,
        paymentDate: row.paymentDate,
        paymentType: row.paymentType,
        rawPaymentType: row.paymentType,
        amount: row.amount,
        amountText: row.amountText,
        currencyCode: row.currencyCode,
        paymentReference: row.paymentReference,
        safeBankAccount: row.safeBankAccount,
        invoiceNumber: row.invoiceNumber,
        workbookCustomerAccount: null,
        workbookCustomerName: null,
        workbookDimension: null,
        workbookFinTag: null,
        isCreditNote: false,
      })),
      issues: template.issues.map((issue) => ({
        sourceSheet: template.sheetName,
        sourceRow: issue.sourceRow,
        column: issue.column,
        message: issue.message,
      })),
    };
  }

  const unmatched = workbook.worksheets.filter(
    (sheet) => !matchYardsSourceLayout(readRowOneHeaders(sheet)),
  );
  if (unmatched.length > 0) {
    throw new YardInvoiceTemplateError(
      `unsupported workbook. Accepted formats: (1) one sheet named "${YARD_INVOICE_TEMPLATE_SHEET}" with the eight template headers; (2) a Yards source workbook whose every sheet matches one of ${YARDS_SOURCE_LAYOUTS.length} known layouts. Sheet(s) not recognised: ${unmatched.map((s) => `"${s.name}"`).join(', ')}.`,
    );
  }

  let parsed;
  try {
    parsed = parseYardsSourceWorkbook(workbook);
  } catch (error) {
    if (error instanceof YardsSourceLayoutError) {
      throw new YardInvoiceTemplateError(error.message);
    }
    throw error;
  }
  return {
    format: 'YARDS_SOURCE',
    formatLabel: YARD_FORMAT_LABELS.YARDS_SOURCE,
    sheets: parsed.sheets,
    records: parsed.records,
    issues: parsed.issues,
  };
}
