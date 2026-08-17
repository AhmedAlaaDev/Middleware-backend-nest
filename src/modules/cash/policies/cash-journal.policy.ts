/**
 * Resolves the journal name used by the cash line payload.
 * Inbound cash always uses Cust-Pay. Outbound cash uses the route's journal
 * when available and preserves the Freight/Fleet fallback names otherwise.
 */
export function resolveCashJournalName(options: {
  inbound: boolean;
  trucking: boolean;
  safeType?: string;
  resolveRoute: (safeType?: string) => { journalName: string } | undefined;
}): string {
  if (options.inbound) return 'Cust-Pay';
  return (
    options.resolveRoute(options.safeType)?.journalName ??
    (options.trucking ? 'P-Fleet' : 'P-Freight')
  );
}

/** Returns the product label used in cash descriptions. */
export function getCashCollectionDescriptionLabel(trucking: boolean): string {
  return trucking ? 'Fleet' : 'Freight';
}
