import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { BaseCashEntryProcessor } from './base-cash-entry.processor';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

@Injectable()
export class CashInTruckingEntryProcessor extends BaseCashEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.CashInTrucking;

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
    Direction: true,
    TruckerType: true,
  };

  constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected isInbound(): boolean {
    return true;
  }

  protected isTrucking(): boolean {
    return true;
  }
}
