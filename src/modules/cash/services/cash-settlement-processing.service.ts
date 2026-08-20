import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { ProcessCustodySettlementEntryCommand } from '@/modules/closing/commands/process-custody-settlement-entry.command';

/**
 * Dispatches custody-settlement rows to the existing Closing command.
 * This service owns orchestration only; the command and its business rules
 * remain unchanged.
 */
export function processCashCustodySettlementLines(options: {
  company: string;
  lines: CashEntryRawDataModel[];
  execute: (command: ProcessCustodySettlementEntryCommand) => Promise<unknown>;
  debug: (message: string) => void;
  error: (message: string) => void;
}): void {
  const { company, lines, execute, debug, error } = options;
  if (lines.length === 0) return;

  const command = new ProcessCustodySettlementEntryCommand(
    company,
    undefined,
    lines,
  );

  execute(command)
    .then(() => {
      debug(
        `[STEP 2.5] Successfully processed ${lines.length} custody settlement lines`,
      );
    })
    .catch((commandError) => {
      error(
        `[STEP 2.5] Error processing custody settlement entry for ${lines.length} lines: ${commandError}`,
      );
    });
}
