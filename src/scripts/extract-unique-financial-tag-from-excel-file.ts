/**
 * Extract unique financial-tag segment values from an Excel file.
 *
 * FinTag segments are parsed into named keys (same order as Yard/Shipping docs),
 * similar to how dimensions are parsed into costCenter/activityName/etc.
 *
 * Usage (must run from D365FOMiddleware_Nestbackend, not Middleware root —
 * `@/` path aliases come from this package's tsconfig):
 *   pnpm extract:unique-fintag
 *   pnpm exec ts-node -r tsconfig-paths/register src/scripts/extract-unique-financial-tag-from-excel-file.ts
 *
 * Change the constants below as needed.
 */
import { promises as fs } from 'fs';
import { resolve } from 'path';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';

/** Absolute or cwd-relative path to the Excel file. */
const EXCEL_FILE_PATH = 'src/excel-sources/Cash/Book2.xlsx';

/** Column header that holds the financial tag display value. */
const HEADER_KEY = 'FINTAGDISPLAYVALUE';

/**
 * Named FinTag field to collect unique values for.
 * Shape (19 segments, pipe-separated), matching project docs:
 * OperationNo|QuotationNo|ShippingLine|Agent|MBL|ContainerNo|ContainerType|HBL|
 * VoyageNo|VesselName|POL|POD|ETA|ETD|ATA|CBMs|Weight|CreationDate|ClosingDate
 */
const PARSED_KEY: FinTagKey = 'shippingLine';

/**
 * FinTag field order — same contract as Yard/Shipping financial tags.
 * Kept local to this script (no shared parser exists in the codebase yet).
 */
const FIN_TAG_FIELDS = [
  'operationNo',
  'quotationNo',
  'shippingLine',
  'agent',
  'mbl',
  'containerNo',
  'containerType',
  'hbl',
  'voyageNo',
  'vesselName',
  'pol',
  'pod',
  'eta',
  'etd',
  'ata',
  'cbms',
  'weight',
  'creationDate',
  'closingDate',
] as const;

type FinTagKey = (typeof FIN_TAG_FIELDS)[number];

type FinTagModel = Record<FinTagKey, string>;

/** Strip bidi / invisible marks commonly present in FO FinTag strings. */
function cleanSegment(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}

function emptyFinTagModel(): FinTagModel {
  return {
    operationNo: '',
    quotationNo: '',
    shippingLine: '',
    agent: '',
    mbl: '',
    containerNo: '',
    containerType: '',
    hbl: '',
    voyageNo: '',
    vesselName: '',
    pol: '',
    pod: '',
    eta: '',
    etd: '',
    ata: '',
    cbms: '',
    weight: '',
    creationDate: '',
    closingDate: '',
  };
}

/** Coerce Excel cell values to string without object `[object Object]` fallback. */
function cellValueToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}

/**
 * Parse a pipe-separated FinTag display value into named keys
 * (analogous to EntryProcessorUtilsService.parseDimensionString).
 */
function parseFinTagDisplayValue(finTagDisplayValue?: unknown): FinTagModel {
  const model = emptyFinTagModel();
  const raw = cellValueToString(finTagDisplayValue);
  if (!raw.trim()) return model;

  const parts = raw.split('|');
  for (let i = 0; i < FIN_TAG_FIELDS.length; i++) {
    const key = FIN_TAG_FIELDS[i];
    model[key] = cleanSegment(parts[i] ?? '');
  }

  return model;
}

function lookupHeaderValue(
  row: Record<string, unknown>,
  headerKey: string,
): string {
  if (row[headerKey] != null) {
    return cellValueToString(row[headerKey]);
  }

  const lower = headerKey.toLowerCase();
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase() === lower && value != null) {
      return cellValueToString(value);
    }
  }

  return '';
}

export async function extractUniqueFinancialTagFromExcelFile(
  filePath: string = EXCEL_FILE_PATH,
  headerKey: string = HEADER_KEY,
  parsedKey: FinTagKey = PARSED_KEY,
): Promise<string[]> {
  const inputPath = resolve(process.cwd(), filePath);
  const buffer = await fs.readFile(inputPath);

  const excelService = new ExcelService(new ExcelJsAdapter());
  const rows = await excelService.excelToJson<Record<string, unknown>>(buffer);

  const unique = new Set<string>();

  for (const row of rows) {
    const raw = lookupHeaderValue(row, headerKey);
    if (!raw.trim()) continue;

    const finTag = parseFinTagDisplayValue(raw);
    const segment = finTag[parsedKey];
    if (segment) {
      unique.add(segment);
    }
  }

  const result = Array.from(unique).sort((a, b) => a.localeCompare(b));

  console.info(
    JSON.stringify(
      {
        filePath: inputPath,
        headerKey,
        parsedKey,
        count: result.length,
        values: result,
      },
      null,
      2,
    ),
  );

  return result;
}

async function main(): Promise<void> {
  await extractUniqueFinancialTagFromExcelFile();
}

main().catch((error: unknown) => {
  console.error('Failed to extract unique financial tags from Excel.');
  console.error(error);
  process.exitCode = 1;
});
