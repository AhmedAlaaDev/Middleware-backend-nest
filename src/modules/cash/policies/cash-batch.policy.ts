import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

/** Assigns deterministic IDs from vouchers without changing existing IDs. */
export function assignCashMissingUniqueIds(lines: CashEntryRawDataModel[]): {
  assignedLineCount: number;
  voucherCount: number;
} {
  if (!lines.some((line) => !line.UniqueId)) {
    return { assignedLineCount: 0, voucherCount: 0 };
  }

  const voucherToId = new Map<string, number>();
  let nextId = 1;
  for (const line of lines) {
    if (line.UniqueId) continue;
    const voucher = (line.VOUCHER || '').trim();
    if (!voucher) {
      line.UniqueId = nextId++;
      continue;
    }
    if (!voucherToId.has(voucher)) voucherToId.set(voucher, nextId++);
    line.UniqueId = voucherToId.get(voucher)!;
  }

  return {
    assignedLineCount: lines.filter((line) => line.UniqueId > 0).length,
    voucherCount: voucherToId.size,
  };
}

/**
 * Splits Cash-In custody settlements from ordinary lines. Cash-Out retains
 * every line on the ordinary path, exactly as the existing processor does.
 */
export function classifyCashLines(
  lines: CashEntryRawDataModel[],
  inbound: boolean,
): {
  custodySettlementLines: CashEntryRawDataModel[];
  otherLines: CashEntryRawDataModel[];
  vendorPayment: CashEntryRawDataModel[];
} {
  if (!inbound) {
    return {
      custodySettlementLines: [],
      otherLines: lines,
      vendorPayment: [],
    };
  }

  const custodySettlementLines: CashEntryRawDataModel[] = [];
  const otherLines: CashEntryRawDataModel[] = [];
  for (const line of lines) {
    (line.IsCustodySettlement ? custodySettlementLines : otherLines).push(line);
  }
  return { custodySettlementLines, otherLines, vendorPayment: [] };
}
