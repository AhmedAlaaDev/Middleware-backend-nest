import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { BaseCashEntryProcessor } from './base-cash-entry.processor';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

@Injectable()
export class CashOutFreightEntryProcessor extends BaseCashEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.CashOutFreight;

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
    FreightType: false,
    Direction: false,
    TruckerType: false,
    TruckNumber: false,
    Worker: false,
  };

  constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected isInbound(): boolean {
    return false;
  }

  protected isTrucking(): boolean {
    return false;
  }
}
