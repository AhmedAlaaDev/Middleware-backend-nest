import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashInEntryProcessor } from '../cash-in-entry.processor';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

@Injectable()
export class CashInFreightEntryProcessor extends CashInEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;

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

  protected isTrucking(): boolean {
    return false;
  }
}
