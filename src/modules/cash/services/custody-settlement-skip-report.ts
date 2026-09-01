import { ICreateDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';

export const CUSTODY_SETTLEMENT_SKIP_KIND = 'custody-settlement-skip';

export type CustodySettlementSkipPhase = 'post' | 'settle';

export interface CustodySettlementSkipRow {
  uniqueId: string;
  excelLineNumbers: number[];
  journalBatchNumber: string;
  d365LineNumbers: number[];
  vendorAccount: string;
  invoiceNumber: string;
  documentNumber: string;
  amount: number | null;
  phase: CustodySettlementSkipPhase;
  error: string;
}

export const CUSTODY_SETTLEMENT_SKIP_EXCEL_HEADERS = [
  'UniqueId',
  'Excel LINENUMBER',
  'JournalBatchNumber',
  'D365 LineNumber',
  'VendorAccount',
  'InvoiceNumber',
  'DocumentNumber',
  'Amount',
  'Phase',
  'Error',
] as const;

export function createCustodySettlementSkipRow(input: {
  uniqueId?: string;
  excelLineNumbers?: Array<number | undefined | null>;
  journalBatchNumber?: string;
  d365LineNumbers?: Array<number | undefined | null>;
  vendorAccount?: string;
  invoiceNumber?: string;
  documentNumber?: string;
  amount?: number | null;
  phase: CustodySettlementSkipPhase;
  error: unknown;
}): CustodySettlementSkipRow {
  return {
    uniqueId: String(input.uniqueId ?? '').trim(),
    excelLineNumbers: uniquePositiveNumbers(input.excelLineNumbers),
    journalBatchNumber: String(input.journalBatchNumber ?? '').trim(),
    d365LineNumbers: uniquePositiveNumbers(input.d365LineNumbers),
    vendorAccount: String(input.vendorAccount ?? '').trim(),
    invoiceNumber: String(input.invoiceNumber ?? '').trim(),
    documentNumber: String(input.documentNumber ?? '').trim(),
    amount:
      input.amount === undefined || input.amount === null
        ? null
        : Number.isFinite(Number(input.amount))
          ? Number(input.amount)
          : null,
    phase: input.phase,
    error: skipErrorMessage(input.error),
  };
}

export function toCustodySettlementSkipExcelRow(
  row: CustodySettlementSkipRow,
): Record<(typeof CUSTODY_SETTLEMENT_SKIP_EXCEL_HEADERS)[number], string> {
  return {
    UniqueId: row.uniqueId,
    'Excel LINENUMBER': row.excelLineNumbers.join(', '),
    JournalBatchNumber: row.journalBatchNumber,
    'D365 LineNumber': row.d365LineNumbers.join(', '),
    VendorAccount: row.vendorAccount,
    InvoiceNumber: row.invoiceNumber,
    DocumentNumber: row.documentNumber,
    Amount: row.amount === null ? '' : String(row.amount),
    Phase: row.phase === 'post' ? 'Upload' : 'Settlement',
    Error: row.error,
  };
}

export function formatCustodySettlementSkipWarning(
  row: CustodySettlementSkipRow,
): string {
  const phase = row.phase === 'post' ? 'Upload skipped' : 'Settlement skipped';
  const uniqueId = row.uniqueId || '?';
  return `${phase}: UniqueId ${uniqueId}${formatExcelLineClause(row.excelLineNumbers)}: ${row.error}`;
}

/** One-line batch status for the UI. Full UniqueId/line detail stays in Excel and the errors page. */
export function formatCustodySettlementSkipBatchSummary(
  rows: CustodySettlementSkipRow[],
): string {
  const uniqueIds = new Set(
    rows.map((row) => row.uniqueId).filter((uniqueId) => uniqueId.length > 0),
  );
  const excelLines = new Set(rows.flatMap((row) => row.excelLineNumbers));
  const uploadCount = rows.filter((row) => row.phase === 'post').length;
  const settlementCount = rows.filter((row) => row.phase === 'settle').length;
  return [
    `Skipped lines: ${rows.length} skipped UniqueId issue(s)`,
    `across ${uniqueIds.size} UniqueId(s)`,
    `and ${excelLines.size} Excel line(s)`,
    `(${uploadCount} upload, ${settlementCount} settlement).`,
    'Open View Errors or download the error Excel for UniqueId, Excel LINENUMBER, and reason.',
  ].join(' ');
}

export function toCustodySettlementSkipBatchError(
  batchId: string,
  validationRunId: string,
  row: CustodySettlementSkipRow,
): ICreateDataBatchError {
  return {
    batchId,
    sourceRecordIds: row.uniqueId
      ? row.uniqueId
          .split(',')
          .map((uniqueId) => uniqueId.trim())
          .filter((uniqueId) => uniqueId.length > 0)
      : [],
    errorMessages: [formatCustodySettlementSkipWarning(row)],
    enhancedRecordIds: row.d365LineNumbers.map(String),
    validationRunId,
    enhancedData: {
      kind: CUSTODY_SETTLEMENT_SKIP_KIND,
      ...row,
    },
  };
}

export function isCustodySettlementSkipError(
  enhancedData: Record<string, unknown> | undefined,
): enhancedData is Record<string, unknown> & CustodySettlementSkipRow & {
  kind: typeof CUSTODY_SETTLEMENT_SKIP_KIND;
} {
  return enhancedData?.kind === CUSTODY_SETTLEMENT_SKIP_KIND;
}

export function skipErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown error');
}

function formatExcelLineClause(lines: number[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return ` Excel line ${lines[0]}`;
  const sorted = [...lines].sort((left, right) => left - right);
  return ` ${lines.length} Excel lines (${sorted[0]}–${sorted[sorted.length - 1]})`;
}

function uniquePositiveNumbers(
  values: Array<number | undefined | null> | undefined,
): number[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ];
}
