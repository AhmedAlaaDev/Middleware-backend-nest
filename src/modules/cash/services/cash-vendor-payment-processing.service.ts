import {
  ProcessVendorPaymentFreightCommand,
  ProcessVendorPaymentTruckingCommand,
} from '@/modules/vendor/commands';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

/**
 * Dispatches vendor-payment rows to the existing Freight/Fleet commands.
 * Product selection remains explicit and the command payload is unchanged.
 */
export function processCashVendorPaymentLines(options: {
  company: string;
  trucking: boolean;
  lines: CashEntryRawDataModel[];
  execute: (
    command:
      | ProcessVendorPaymentFreightCommand
      | ProcessVendorPaymentTruckingCommand,
  ) => Promise<unknown>;
  debug: (message: string) => void;
  error: (message: string) => void;
}): void {
  const { company, trucking, lines, execute, debug, error } = options;
  if (lines.length === 0) return;

  const command = trucking
    ? new ProcessVendorPaymentTruckingCommand(company, undefined, lines)
    : new ProcessVendorPaymentFreightCommand(company, undefined, lines);

  execute(command)
    .then(() => {
      debug(
        `[STEP 2.5] Successfully processed ${lines.length} vendor payment lines`,
      );
    })
    .catch((commandError) => {
      error(
        `[STEP 2.5] Error processing vendor payment entry for ${lines.length} lines: ${commandError}`,
      );
    });
}
