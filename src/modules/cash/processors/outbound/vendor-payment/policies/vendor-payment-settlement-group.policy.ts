import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { resolveCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { normalizeVendorInvoiceIdentity } from './vendor-invoice-identity.policy';
import { VendorPaymentSettlement } from './vendor-payment-marked-lines.policy';

/**
 * The current X++ standard-vendor settlement resolves VendTrans by vendor and
 * invoice; OperationNumber is metadata and is not part of that lookup. Keep
 * repeated source rows for the same vendor/document/invoice together so the
 * invoice is marked only once.
 */
export function groupVendorPaymentSettlementsByInvoice(
  settlements: readonly VendorPaymentSettlement[],
): VendorPaymentSettlement[][] {
  const groups = new Map<string, VendorPaymentSettlement[]>();

  for (const settlement of settlements) {
    const line = settlement.vendorLine;
    const invoice = resolveCashOutboundInvoice(
      line.MARKEDINVOICE,
      line.INVOICE,
    );
    const key = [
      String(line.ACCOUNTDISPLAYVALUE ?? '').trim().toLowerCase(),
      String(line.DOCUMENT ?? '').trim().toLowerCase(),
      normalizeVendorInvoiceIdentity(invoice) ||
        `line:${String(line.LINENUMBER ?? '').trim()}`,
      String(line.CURRENCYCODE ?? '').trim().toLowerCase(),
    ].join('|');
    const group = groups.get(key) ?? [];
    group.push(settlement);
    groups.set(key, group);
  }

  return [...groups.values()];
}

/** Aggregates only rows sharing the same invoice transaction identity. */
export function aggregateVendorPaymentInvoiceLine(
  settlements: readonly VendorPaymentSettlement[],
): CashEntryRawDataModel {
  const first = settlements[0]?.vendorLine;
  if (!first) {
    throw new Error('Cannot aggregate an empty Vendor Payment settlement group');
  }

  return Object.assign(Object.create(Object.getPrototypeOf(first)), first, {
    DEBITAMOUNT: settlements.reduce(
      (sum, settlement) =>
        sum + Number(settlement.vendorLine.DEBITAMOUNT ?? 0),
      0,
    ),
    CREDITAMOUNT: 0,
  });
}
