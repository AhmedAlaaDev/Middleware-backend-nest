import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashProductLine } from '@/modules/cash/types';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

/**
 * Converts generic Excel rows into Cash raw models while preserving row order.
 * The product type and direction are explicit inputs so Freight/Fleet and
 * Cash-In/Cash-Out construction cannot be inferred differently by callers.
 */
export function mapCashRawData(
  data: EntryRawDataModel[],
  product: CashProductLine,
  inbound: boolean,
): CashEntryRawDataModel[] {
  return data.map((row) => new CashEntryRawDataModel(row, product, inbound));
}
