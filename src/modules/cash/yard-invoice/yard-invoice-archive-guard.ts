import { YARD_INVOICE_LIMITS } from './yard-invoice.constants';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_SEARCH = 65557;
const CENTRAL_HEADER_SIZE = 46;

export class YardInvoiceArchiveError extends Error {}

const FORBIDDEN_ENTRY_PATTERN = /(vbaproject\.bin|\.\.|^\/|^[a-zA-Z]:)/i;

/**
 * Reads only the ZIP central directory, before any unzip. It rejects
 * archives that are not xlsx-shaped, that carry macros, that declare too many
 * entries, or whose uncompressed size or compression ratio looks like a
 * ZIP bomb. The check is structural: it does not decompress anything.
 */
export function assertSafeXlsxArchive(buffer: Buffer): void {
  if (!Buffer.isBuffer(buffer) || buffer.length < EOCD_MIN_SIZE) {
    throw new YardInvoiceArchiveError('file is not a valid .xlsx package');
  }
  if (buffer.length > YARD_INVOICE_LIMITS.maxFileBytes) {
    throw new YardInvoiceArchiveError(
      `file exceeds the ${YARD_INVOICE_LIMITS.maxFileBytes} byte limit`,
    );
  }
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new YardInvoiceArchiveError('file is not a ZIP-based .xlsx package');
  }

  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new YardInvoiceArchiveError('ZIP64 workbooks are not accepted');
  }
  if (entryCount === 0 || entryCount > YARD_INVOICE_LIMITS.maxArchiveEntries) {
    throw new YardInvoiceArchiveError(
      `workbook package has ${entryCount} entries (limit ${YARD_INVOICE_LIMITS.maxArchiveEntries})`,
    );
  }
  if (centralOffset + centralSize > eocd) {
    throw new YardInvoiceArchiveError('ZIP central directory is malformed');
  }

  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entryCount; i++) {
    if (
      cursor + CENTRAL_HEADER_SIZE > buffer.length ||
      buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
    ) {
      throw new YardInvoiceArchiveError('ZIP central directory is malformed');
    }
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const name = buffer
      .subarray(
        cursor + CENTRAL_HEADER_SIZE,
        cursor + CENTRAL_HEADER_SIZE + nameLength,
      )
      .toString('utf8');

    if (FORBIDDEN_ENTRY_PATTERN.test(name)) {
      throw new YardInvoiceArchiveError(
        `workbook package contains a disallowed entry (${name.slice(0, 80)})`,
      );
    }

    totalUncompressed += uncompressed;
    if (totalUncompressed > YARD_INVOICE_LIMITS.maxUncompressedBytes) {
      throw new YardInvoiceArchiveError(
        'workbook expands beyond the size limit',
      );
    }
    if (
      uncompressed > 1024 * 1024 &&
      compressed > 0 &&
      uncompressed / compressed > YARD_INVOICE_LIMITS.maxCompressionRatio
    ) {
      throw new YardInvoiceArchiveError(
        'workbook has a suspicious compression ratio',
      );
    }

    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_MAX_SEARCH);
  for (let pos = buffer.length - EOCD_MIN_SIZE; pos >= start; pos--) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) {
      return pos;
    }
  }
  throw new YardInvoiceArchiveError('ZIP end-of-central-directory not found');
}
