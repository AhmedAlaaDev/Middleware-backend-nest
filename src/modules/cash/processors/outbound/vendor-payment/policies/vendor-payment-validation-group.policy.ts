import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { resolveCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { normalizeVendorInvoiceIdentity } from './vendor-invoice-identity.policy';

/**
 * Groups source rows that together settle one D365 vendor transaction.
 * Repeated rows with the same UniqueId are portions of one invoice amount and
 * must be validated using their aggregate, not row by row.
 */
export function groupVendorPaymentValidationLines(
  lines: readonly CashEntryRawDataModel[],
): CashEntryRawDataModel[][] {
  const groups = new Map<string, CashEntryRawDataModel[]>();

  for (const line of lines) {
    const invoice = resolveCashOutboundInvoice(
      line.MARKEDINVOICE,
      line.INVOICE,
    );
    const sourceGroup =
      String(line.UniqueId ?? '').trim() ||
      String(line.VOUCHER ?? '').trim() ||
      `line:${String(line.LINENUMBER ?? '').trim()}`;
    const key = [
      sourceGroup,
      String(line.ACCOUNTDISPLAYVALUE ?? '')
        .trim()
        .toLowerCase(),
      String(line.DOCUMENT ?? '')
        .trim()
        .toLowerCase(),
      normalizeVendorInvoiceIdentity(invoice),
      String(line.CURRENCYCODE ?? '')
        .trim()
        .toLowerCase(),
    ].join('|');

    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  return [...groups.values()];
}
