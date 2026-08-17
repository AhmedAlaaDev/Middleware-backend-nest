import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashOutEntryProcessor } from '../cash-out-entry.processor';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

@Injectable()
export class CashOutTruckingEntryProcessor extends CashOutEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.CashOutTrucking;

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: false,
    Activity: false,
    CostCenters: false,
    BusinessUnit: false,
    Location: false,
    Customer: false,
    SubCustomer: false,
    Vendor: false,
    SubVendor: false,
    ChargeType: false,
    SalesMan: false,
    CoordinatorMan: false,
    Direction: false,
    TruckerType: false,
    TruckNumber: false,
    FreightType: false,
    Worker: false,
  };

  constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected isTrucking(): boolean {
    return true;
  }
}
