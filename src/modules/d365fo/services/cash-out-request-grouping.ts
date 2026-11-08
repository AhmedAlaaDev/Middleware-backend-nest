/**
 * Request grouping rules for Cash-Out Custody Settlement posting.
 *
 * D365 voucher assignment (TSLedgerJournalIntegration.addLedgerJournalTransVendPaym)
 * is local to ONE request: lines without an offset account share a voucher until
 * the running debit equals the running credit, then a new voucher starts. A
 * request therefore only produces balanced vouchers when the lines it contains
 * balance on their own. Splitting one UniqueId into several requests is only
 * safe when every resulting request balances by itself.
 *
 * All arithmetic uses integer minor units (cents); there is no tolerance.
 */

export interface CashOutGroupingLine {
  uniqueId: string;
  /** Invoice used to split a UniqueId into per-invoice requests (may be blank). */
  invoice: string;
  /** True when the line carries no offset account (X++ balances only these). */
  offsetless: boolean;
  debitCents: number;
  creditCents: number;
}

/** Converts a decimal money amount to integer cents (no float noise). */
export function toCashOutCents(amount: unknown): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Cash-Out source exports use 0/00/000 as an empty invoice placeholder; it is
 * treated exactly like a blank invoice.
 */
export function normalizeCashOutGroupInvoice(
  invoice: string | null | undefined,
): string {
  const normalized = (invoice ?? '').trim();
  return /^0+$/.test(normalized) ? '' : normalized;
}

export function cashOutInvoiceSplitKey(
  uniqueId: string,
  invoice: string | null | undefined,
): string | undefined {
  const normalized = normalizeCashOutGroupInvoice(invoice);
  return normalized ? `${uniqueId}::${normalized}` : undefined;
}

/** Offset-less debit minus credit, in cents. 0 means the lines self-balance. */
export function cashOutOffsetlessNetCents(
  lines: ReadonlyArray<
    Pick<CashOutGroupingLine, 'offsetless' | 'debitCents' | 'creditCents'>
  >,
): number {
  let net = 0;
  for (const line of lines) {
    if (!line.offsetless) continue;
    net += line.debitCents - line.creditCents;
  }
  return net;
}

/**
 * Decides which per-invoice requests of a UniqueId may be split off.
 *
 * A `uniqueId::invoice` key is returned only when the lines of that invoice
 * balance by themselves. Every other line (blank invoice, placeholder invoice,
 * or an invoice group that does not balance alone) stays in the UniqueId's main
 * request, so the main request is balanced whenever the UniqueId is.
 */
export function resolveBalancedInvoiceSplitKeys(
  lines: ReadonlyArray<CashOutGroupingLine>,
): Set<string> {
  const byKey = new Map<string, CashOutGroupingLine[]>();
  for (const line of lines) {
    const key = cashOutInvoiceSplitKey(line.uniqueId, line.invoice);
    if (!key) continue;
    const group = byKey.get(key) ?? [];
    group.push(line);
    byKey.set(key, group);
  }

  const splittable = new Set<string>();
  for (const [key, group] of byKey) {
    if (cashOutOffsetlessNetCents(group) === 0) splittable.add(key);
  }
  return splittable;
}

/**
 * X++ closes a voucher once |running debit - running credit| <= 0.01, i.e. one
 * cent. The mirror below uses the same platform rule; the invoice-split plan
 * above stays strict (exact cents).
 */
export const XPP_VOUCHER_CLOSE_TOLERANCE_CENTS = 1;

/**
 * Mirror of the X++ voucher rule, used to prove a request cannot leave an open
 * (unbalanced) voucher. Returns the lines still sitting in an unbalanced
 * voucher at the end of the request.
 */
export function simulateCashOutVouchers(
  lines: ReadonlyArray<
    Pick<CashOutGroupingLine, 'offsetless' | 'debitCents' | 'creditCents'>
  >,
): { vouchers: number; openLines: number; openNetCents: number } {
  let debit = 0;
  let credit = 0;
  let vouchers = 0;
  let open = 0;
  for (const line of lines) {
    if (!line.offsetless) {
      vouchers++;
      continue;
    }
    open++;
    debit += line.debitCents;
    credit += line.creditCents;
    if (Math.abs(debit - credit) <= XPP_VOUCHER_CLOSE_TOLERANCE_CENTS) {
      vouchers++;
      debit = 0;
      credit = 0;
      open = 0;
    }
  }
  return { vouchers, openLines: open, openNetCents: debit - credit };
}
