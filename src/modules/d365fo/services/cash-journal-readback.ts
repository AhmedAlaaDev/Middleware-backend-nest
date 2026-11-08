import {
  ActualJournalLine,
  JournalIntegrityCode,
  journalLineIdentityKey,
  compareLedgerDimensions,
  normalizeJournalAccountType,
  normalizeLedgerDimensions,
  PlannedJournalLine,
} from './cash-journal-line-identity';

/**
 * Post-write verification of a Cash-Out Custody Settlement journal.
 *
 * Counts alone cannot prove integrity (a missing debit and a duplicated
 * credit still add up), and totals alone can cancel. The ACTUAL D365 lines of
 * the whole journal are compared with the EXPECTED lines of the whole journal
 * (the batch's planned lines minus skipped UniqueIds), line by line, by the
 * composite identity in cash-journal-line-identity.ts.
 *
 * Financial dimensions: D365 drops the dimension values its account structure
 * does not allow for a main account (223404 keeps 4 of 13). A dropped value is
 * therefore accepted (and counted); a CHANGED or ADDED value is a mismatch.
 *
 * The X++ voucher rule is 1 cent: a voucher closes once |debit - credit| <= 0.01.
 */

export interface JournalIntegrityError {
  code: JournalIntegrityCode;
  message: string;
}

export interface JournalVerificationInput {
  journalNumber: string;
  /** Expected lines of the whole journal. */
  planned: readonly PlannedJournalLine[];
  /** Every actual line of the journal (all pages). */
  actual: readonly ActualJournalLine[];
  /**
   * Verify that each D365 voucher balances. Only valid when every planned line
   * is offset-less (Custody Settlement), since X++ balances only those.
   */
  checkVoucherBalance: boolean;
}

const VOUCHER_TOLERANCE_CENTS = 1;
const SAMPLE_LIMIT = 5;

const describe = (line: {
  paymentId: string;
  accountType: string;
  account: string;
  currency: string;
  debitCents: number;
  creditCents: number;
}): string =>
  `UniqueId ${line.paymentId || '(blank)'} ${line.accountType} ${line.account.split('|')[0]} ${line.currency} debit ${line.debitCents} credit ${line.creditCents} cents`;

const group = <T extends Parameters<typeof journalLineIdentityKey>[0]>(
  lines: readonly T[],
): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const line of lines) {
    const key = journalLineIdentityKey(line);
    map.set(key, [...(map.get(key) ?? []), line]);
  }
  return map;
};

export interface JournalVerificationResult {
  errors: JournalIntegrityError[];
  /** Ledger lines whose dimension values D365's account structure dropped. */
  droppedDimensionLines: number;
}

export function verifyJournalContent(
  input: JournalVerificationInput,
): JournalIntegrityError[] {
  return verifyJournalContentDetailed(input).errors;
}

export function verifyJournalContentDetailed(
  input: JournalVerificationInput,
): JournalVerificationResult {
  const errors: JournalIntegrityError[] = [];
  let droppedDimensionLines = 0;
  const { journalNumber, planned, actual } = input;
  const plannedByKey = group(planned);
  const actualByKey = group(actual);
  const plannedIds = new Set(
    planned.map((line) => line.paymentId.trim().toLowerCase()),
  );

  // 1. Missing lines: fewer identical lines in D365 than planned.
  const missing: string[] = [];
  let missingCount = 0;
  for (const [key, lines] of plannedByKey) {
    const present = actualByKey.get(key)?.length ?? 0;
    if (present < lines.length) {
      missingCount += lines.length - present;
      if (missing.length < SAMPLE_LIMIT) missing.push(describe(lines[0]));
    }
  }
  if (missingCount > 0) {
    errors.push({
      code: 'JOURNAL_LINES_MISSING',
      message: `Journal ${journalNumber} is missing ${missingCount} planned line(s) in D365, e.g. ${missing.join('; ')}.`,
    });
  }

  // 2. Duplicated, wrong or unexpected lines.
  const wrong: string[] = [];
  let wrongCount = 0;
  for (const [key, lines] of actualByKey) {
    const expected = plannedByKey.get(key)?.length ?? 0;
    if (lines.length > expected) {
      wrongCount += lines.length - expected;
      if (wrong.length < SAMPLE_LIMIT) {
        const known = plannedIds.has(lines[0].paymentId.trim().toLowerCase());
        wrong.push(
          `${expected === 0 ? (known ? 'wrong account/currency/amount' : 'unexpected UniqueId') : 'duplicate'}: ${describe(lines[0])} (D365 line ${lines[0].lineNumber})`,
        );
      }
    }
  }
  if (wrongCount > 0) {
    errors.push({
      code: 'JOURNAL_LINE_MISMATCH',
      message: `Journal ${journalNumber} holds ${wrongCount} line(s) that do not match the plan: ${wrong.join('; ')}.`,
    });
  }

  // 3. Ledger dimensions of otherwise matching lines. Exact matches are paired
  // first, then lines whose values D365 dropped; a changed or added value, or
  // a line that pairs with nothing, is a mismatch.
  const dimensionIssues: string[] = [];
  for (const [key, lines] of plannedByKey) {
    const actualLines = actualByKey.get(key);
    if (!actualLines || actualLines.length !== lines.length) continue;
    if (normalizeJournalAccountType(lines[0].accountType) !== 'ledger')
      continue;

    const remaining = actualLines.map((line) => line.account);
    const pending: string[] = [];
    for (const line of lines) {
      const index = remaining.findIndex(
        (account) => compareLedgerDimensions(line.account, account) === 'EXACT',
      );
      if (index >= 0) remaining.splice(index, 1);
      else pending.push(line.account);
    }
    for (const expectedDimensions of pending) {
      const index = remaining.findIndex(
        (account) =>
          compareLedgerDimensions(expectedDimensions, account) === 'DROPPED',
      );
      if (index >= 0) {
        remaining.splice(index, 1);
        droppedDimensionLines++;
      } else if (dimensionIssues.length < SAMPLE_LIMIT) {
        dimensionIssues.push(
          `${describe(lines[0])} dimensions "${normalizeLedgerDimensions(expectedDimensions)}" (D365 holds a different value)`,
        );
      }
    }
  }
  if (dimensionIssues.length > 0) {
    errors.push({
      code: 'JOURNAL_LINE_MISMATCH',
      message: `Journal ${journalNumber} has ledger lines whose financial dimensions were changed or added in D365: ${dimensionIssues.join('; ')}.`,
    });
  }

  // 3b. Voucher balance, from the D365 values.
  if (input.checkVoucherBalance) {
    const vouchers = new Map<string, ActualJournalLine[]>();
    for (const line of actual) {
      if (!line.voucher) continue;
      vouchers.set(line.voucher, [...(vouchers.get(line.voucher) ?? []), line]);
    }
    const unbalanced: string[] = [];
    for (const [voucher, lines] of vouchers) {
      // Nominal amounts of different currencies cannot be compared.
      if (new Set(lines.map((l) => l.currency.toUpperCase())).size > 1)
        continue;
      const net = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
      if (
        Math.abs(net) > VOUCHER_TOLERANCE_CENTS &&
        unbalanced.length < SAMPLE_LIMIT
      ) {
        unbalanced.push(`${voucher} (${net} cents)`);
      }
    }
    if (unbalanced.length > 0) {
      errors.push({
        code: 'JOURNAL_IMBALANCE',
        message: `Journal ${journalNumber} has unbalanced D365 voucher(s): ${unbalanced.join('; ')}.`,
      });
    }
  }

  return { errors, droppedDimensionLines };
}

/** Builds the single error thrown when verification fails. */
export function formatJournalIntegrityFailure(
  errors: readonly JournalIntegrityError[],
): string {
  const codes = [...new Set(errors.map((e) => e.code))];
  return `${codes.map((c) => `[${c}]`).join('')} ${errors
    .map((e) => e.message)
    .join(' ')} Invoice settlement marks were not written.`;
}
