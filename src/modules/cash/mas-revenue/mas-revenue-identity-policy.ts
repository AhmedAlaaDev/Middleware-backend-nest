import {
  masRevenueFingerprint,
  masRevenueIdentity,
  reliableYear,
  type MasRevenueReceiptIdentity,
} from './mas-revenue-identity';

import type { MasRevenueReceipt } from './mas-revenue.types';

/**
 * A receipt that already exists for this company: a submitted batch line, a
 * version 2 claim, or a claim still in progress. Legacy lines carry no identity
 * key, so their year comes from their stored date when that date is reliable.
 */
export interface MasRevenuePriorReceipt {
  invoiceNumber: string;
  /** Calendar year of the stored date, or null when the date is not reliable. */
  year: number | null;
  /** Content fingerprint when it can be computed, otherwise null. */
  fingerprint: string | null;
  /** Version 2 identity key, or null for a legacy record. */
  identityKey: string | null;
  /** Human-readable reference (batch or review) for the message. */
  reference: string;
}

export type MasRevenueIdentityConflict =
  | {
      code: 'DUPLICATE_RECEIPT';
      invoiceNumber: string;
      year: number;
      reference: string;
    }
  | {
      code: 'RECONCILIATION_REQUIRED';
      invoiceNumber: string;
      reference: string;
      reason: string;
    }
  | {
      code: 'CORRECTION_REQUIRED';
      invoiceNumber: string;
      year: number;
      priorYear: number;
      reference: string;
    }
  | {
      code: 'PAYMENT_ID_COLLISION';
      invoiceNumber: string;
      paymentIdBase: string;
    };

export interface MasRevenueIdentityEvaluation {
  identities: MasRevenueReceiptIdentity[];
  conflicts: MasRevenueIdentityConflict[];
}

/**
 * Decides, without any I/O, whether the receipts may create new financial
 * records. The database unique indexes remain the final guard against races.
 *
 *   duplicate         same company, source, year and invoice (any version)
 *   reconciliation    a prior record for the invoice has no reliable year
 *   correction        the same invoice in another year with the same content:
 *                     a re-dated submitted receipt, which must not become a new
 *                     transaction silently
 *   distinct          same invoice, another year, different content: a new identity
 */
export function evaluateMasRevenueReceiptIdentities(
  receipts: MasRevenueReceipt[],
  priors: MasRevenuePriorReceipt[],
): MasRevenueIdentityEvaluation {
  const identities = receipts.map((receipt) =>
    masRevenueIdentity({
      transactionDate: receipt.transactionDate,
      invoiceNumber: receipt.invoiceNumber,
    }),
  );
  const conflicts: MasRevenueIdentityConflict[] = [];

  receipts.forEach((receipt, index) => {
    const identity = identities[index];
    const fingerprint = masRevenueFingerprint(receipt);
    for (const prior of priors) {
      if (prior.invoiceNumber !== receipt.invoiceNumber) continue;

      if (prior.identityKey !== null && prior.identityKey === identity.key) {
        conflicts.push({
          code: 'DUPLICATE_RECEIPT',
          invoiceNumber: receipt.invoiceNumber,
          year: identity.year,
          reference: prior.reference,
        });
        continue;
      }
      if (prior.year === null) {
        conflicts.push({
          code: 'RECONCILIATION_REQUIRED',
          invoiceNumber: receipt.invoiceNumber,
          reference: prior.reference,
          reason:
            'the existing record has no reliable transaction date; reconcile it before submitting this invoice',
        });
        continue;
      }
      if (prior.year === identity.year) {
        conflicts.push({
          code: 'DUPLICATE_RECEIPT',
          invoiceNumber: receipt.invoiceNumber,
          year: identity.year,
          reference: prior.reference,
        });
        continue;
      }
      if (prior.fingerprint !== null && prior.fingerprint === fingerprint) {
        conflicts.push({
          code: 'CORRECTION_REQUIRED',
          invoiceNumber: receipt.invoiceNumber,
          year: identity.year,
          priorYear: prior.year,
          reference: prior.reference,
        });
      }
    }
  });

  // Distinct identities must also have distinct PaymentIds. A collision here is
  // refused, never resolved by changing the identifier silently.
  const seen = new Map<string, string>();
  identities.forEach((identity, index) => {
    const invoiceNumber = receipts[index].invoiceNumber;
    const previous = seen.get(identity.paymentIdBase);
    if (previous !== undefined && previous !== identity.key) {
      conflicts.push({
        code: 'PAYMENT_ID_COLLISION',
        invoiceNumber,
        paymentIdBase: identity.paymentIdBase,
      });
    }
    seen.set(identity.paymentIdBase, identity.key);
  });

  return { identities, conflicts };
}

/** Year of a stored date, or null. Re-exported for prior-receipt construction. */
export { reliableYear };
