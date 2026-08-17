import { CommandBus } from '@nestjs/cqrs';

import { BaseCashEntryProcessor } from '../base/base-cash-entry.processor';

import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';

/**
 * Shared Cash-In processor boundary.
 *
 * This class owns only the invariant that Cash-In uses inbound processing.
 * Transformation, validation, lookup order, and D365FO payload behavior stay
 * in the existing base processor until each responsibility is characterized.
 */
export abstract class CashInEntryProcessor extends BaseCashEntryProcessor {
  protected constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  /** Cash-In records are customer collections and follow inbound rules. */
  protected isInbound(): boolean {
    return true;
  }
}
