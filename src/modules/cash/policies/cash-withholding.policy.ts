import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CashWithholdingStats {
  withholdingRemovedCount: number;
  withholdingRemovedAmount: number;
}

export function isCashWithholdingLedgerLine(
  line: CashEntryRawDataModel,
): boolean {
  if (!line) return false;
  const accountType = String(line.ACCOUNTTYPE ?? '').trim().toLowerCase();
  const accountDisplay = String(line.ACCOUNTDISPLAYVALUE ?? '').trim();
  const isLedger =
    line.IsLedger ||
    accountType === 'ledger' ||
    accountType === 'ledger account' ||
    accountType === 'mainaccount';

  return isLedger && accountDisplay.startsWith('223304');
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
