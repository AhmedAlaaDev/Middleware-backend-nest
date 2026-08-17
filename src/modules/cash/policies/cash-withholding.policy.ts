import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CashWithholdingStats {
  withholdingRemovedCount: number;
  withholdingRemovedAmount: number;
}

/** Identifies the 223304 ledger account used for withholding treatment. */
export function isCashWithholdingLedgerLine(
  line: CashEntryRawDataModel,
): boolean {
  return (
    line.ACCOUNTTYPE === 'Ledger' &&
    String(line.ACCOUNTDISPLAYVALUE ?? '')
      .trim()
      .startsWith('223304')
  );
}

/**
 * Collects withholding statistics by voucher without mutating source lines.
 * The caller decides how SafeType routes the identified withholding amount.
 */
export function analyzeCashWithholding(
  lines: CashEntryRawDataModel[],
): CashWithholdingStats {
  const voucherGroups = new Map<string, CashEntryRawDataModel[]>();
  for (const line of lines) {
    const voucher = line.VOUCHER;
    if (!voucher) continue;
    if (!voucherGroups.has(voucher)) voucherGroups.set(voucher, []);
    voucherGroups.get(voucher)!.push(line);
  }

  let withholdingRemovedCount = 0;
  let withholdingRemovedAmount = 0;
  for (const groupLines of voucherGroups.values()) {
    for (const line of groupLines.filter(isCashWithholdingLedgerLine)) {
      withholdingRemovedCount++;
      withholdingRemovedAmount += line.CREDITAMOUNT || line.DEBITAMOUNT;
    }
  }

  return { withholdingRemovedCount, withholdingRemovedAmount };
}
