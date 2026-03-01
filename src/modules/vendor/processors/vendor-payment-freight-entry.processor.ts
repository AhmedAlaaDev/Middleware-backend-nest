import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { BaseVendorEntryProcessor } from '@/modules/vendor/processors/base-vendor-entry.processor';

@Injectable()
export class VendorPaymentFreightEntryProcessor extends BaseVendorEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.VendorPaymentFreight;
  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Customer: true,
    SubCustomer: false,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    ChargeType: true,
    SalesMan: true,
    FreightType: true,
    CoordinatorMan: true,
    Direction: true,
    Vendor: true,
    SubVendor: false,
  };

  constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected getJournalName(): string {
    return 'P-Freight';
  }

  protected getDescriptionPrefix(): string {
    return 'Vendor Payment Freight';
  }
}
