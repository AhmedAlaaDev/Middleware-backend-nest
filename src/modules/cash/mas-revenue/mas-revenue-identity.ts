import { createHash } from 'crypto';

import { normalizeSourceText } from './mas-revenue-workbook.parser';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';
import { MasRevenueError, type MasRevenueReceipt } from './mas-revenue.types';

/**
 * MAS Direct Revenue integration identity.
 *
 * Identity = company + server-defined source namespace + transaction year +
 * original invoice number. The year is the receipt's TransactionDate year under
 * the current template contract. It is the transaction year, not an
 * independently verified invoice fiscal year. Nothing else contributes: not the
 * upload time, the current year, the file name, or any user-editable label.
 *
 * Version 1 is the legacy scheme (invoice number only, no year). Records without
 * `IdentityVersion` are version 1 and keep their stored PaymentIds unchanged.
 */

export const MAS_REVENUE_IDENTITY_VERSION = 2 as const;

/** Server-defined namespace. Never read from a file, a column or the request. */
export const MAS_REVENUE_SOURCE_NAMESPACE = 'MAS_DIRECT_REVENUE';

/**
 * Conservative PaymentId limit. The repository has no verified MaxLength for
 * LedgerJournalLines.PaymentId (the metadata leaves it empty). Until the sandbox
 * confirms it, every generated PaymentId must fit this limit or the post is
 * refused. An identifier is never truncated.
 */
export const MAS_REVENUE_PAYMENT_ID_MAX_LENGTH = 30;

/** Hex characters of the identity hash kept in a version 2 PaymentId (64 bits). */
const PAYMENT_ID_HASH_CHARS = 16;

export interface MasRevenueReceiptIdentity {
  version: typeof MAS_REVENUE_IDENTITY_VERSION;
  company: string;
  source: string;
  year: number;
  /** Original invoice number, normalized with the same rule as validation. */
  invoiceNumber: string;
  /** Canonical, injective encoding of the identity fields (JSON array). */
  key: string;
  /** SHA-256 of `key`, lower-case hex. */
  hash: string;
  /** Version 2 PaymentId without a line suffix: MR<year>-<16 hex>. */
  paymentIdBase: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar year of a canonical YYYY-MM-DD date, or null when the date is not
 * a real calendar date in a plausible range. Ambiguous dates never produce a year.
 */
export function reliableYear(transactionDate: string): number | null {
  const match = ISO_DATE.exec(transactionDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return year >= 2000 && year <= 2100 ? year : null;
}

/** Builds the version 2 identity. Throws when the year or invoice cannot be used. */
export function masRevenueIdentity(input: {
  company?: string;
  transactionDate: string;
  invoiceNumber: string;
}): MasRevenueReceiptIdentity {
  const company = input.company ?? MAS_REVENUE_COMPANY_ID;
  const year = reliableYear(input.transactionDate);
  if (year === null) {
    throw new MasRevenueError(
      `transaction date "${input.transactionDate}" is not a reliable calendar date; the identity cannot be formed`,
    );
  }
  const invoiceNumber = normalizeSourceText(input.invoiceNumber);
  if (invoiceNumber === '') {
    throw new MasRevenueError('invoice number is required for the identity');
  }
  const key = JSON.stringify([
    MAS_REVENUE_IDENTITY_VERSION,
    company,
    MAS_REVENUE_SOURCE_NAMESPACE,
    year,
    invoiceNumber,
  ]);
  const hash = sha256Hex(key);
  return {
    version: MAS_REVENUE_IDENTITY_VERSION,
    company,
    source: MAS_REVENUE_SOURCE_NAMESPACE,
    year,
    invoiceNumber,
    key,
    hash,
    paymentIdBase: `MR${year}-${hash.slice(0, PAYMENT_ID_HASH_CHARS).toUpperCase()}`,
  };
}

/**
 * The PaymentId without a line suffix. Version 2 is hash based, so any invoice
 * text fits and no two identities share an id. Version 1 (legacy) is unchanged.
 */
export function masRevenuePaymentIdBase(receipt: {
  invoiceNumber: string;
  transactionDate: string;
  identityVersion?: number;
}): string {
  if (receipt.identityVersion === MAS_REVENUE_IDENTITY_VERSION) {
    return masRevenueIdentity({
      transactionDate: receipt.transactionDate,
      invoiceNumber: receipt.invoiceNumber,
    }).paymentIdBase;
  }
  return `MASREV-${receipt.invoiceNumber}`;
}

/** Line-level PaymentId for the GL route: base plus the REV or VAT suffix. */
export function masRevenueGlPaymentId(
  receipt: {
    invoiceNumber: string;
    transactionDate: string;
    identityVersion?: number;
  },
  suffix: 'REV' | 'VAT',
): string {
  if (receipt.identityVersion === MAS_REVENUE_IDENTITY_VERSION) {
    return `${masRevenuePaymentIdBase(receipt)}-${suffix}`;
  }
  // Legacy: kept exactly as it was posted, so retries and readback still match.
  return `MASREV-${receipt.invoiceNumber}-${suffix}`;
}

/**
 * Content fingerprint of a receipt, excluding its date, row position and currency (the currency is derived from the D365 cash account and can change). Two
 * receipts with the same invoice in different years and the same fingerprint are
 * treated as one receipt that was re-dated, which needs explicit correction.
 */
export function masRevenueFingerprint(receipt: MasRevenueReceipt): string {
  return sha256Hex(
    JSON.stringify([
      receipt.valueMinor,
      receipt.vatMinor,
      receipt.totalMinor,
      receipt.cashAccountDisplayName,
      receipt.customerName,
      receipt.containerType,
      receipt.containerNumber,
      receipt.billOfLading,
      receipt.revenueType,
      receipt.seaLine,
      receipt.vatCardNumber,
    ]),
  );
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
