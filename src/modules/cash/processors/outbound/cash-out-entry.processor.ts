import { CommandBus } from '@nestjs/cqrs';

import { BaseCashEntryProcessor } from '../base/base-cash-entry.processor';

import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';

/**
 * Shared Cash-Out processor boundary.
 *
 * This class owns only the invariant that Cash-Out uses outbound processing.
 * Source validation, FX, withholding, vendor settlement, and D365FO payload
 * behavior remain unchanged in the existing base processor.
 */
export abstract class CashOutEntryProcessor extends BaseCashEntryProcessor {
  protected constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  /** Cash-Out records are payments and follow outbound rules. */
  protected isInbound(): boolean {
    return false;
  }
}
