import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashInDirectEntryProcessor } from '../direct/cash-in-direct-entry.processor';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { CashProductLine } from '@/modules/cash/types';

@Injectable()
export class CashInShiplinkEntryProcessor extends CashInDirectEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.CashInShiplink;

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    Customer: true,
    SubCustomer: true,
    ChargeType: false,
    SalesMan: false,
    CoordinatorMan: false,
    FreightType: true,
    Direction: true,
  };

  constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected getDirectProduct(): CashProductLine {
    return 'Shiplink';
  }
}
