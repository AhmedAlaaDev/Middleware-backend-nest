import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryDynDataModel } from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { VendorEntryDynDataModel } from '@/modules/vendor/models';
import { BaseVendorEntryProcessor } from '@/modules/vendor/processors/base-vendor-entry.processor';

@Injectable()
export class VendorPaymentTruckingEntryProcessor extends BaseVendorEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.VendorPaymentTrucking;
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
    CoordinatorMan: true,
    Direction: true,
    TruckerType: true,
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
    return 'P-Fleet';
  }

  protected getDescriptionPrefix(): string {
    return 'Vendor Payment Fleet';
  }

  public validateAsync(data: EntryDynDataModel[]): EntryDynDataModel[] {
    const lines = data as unknown as VendorEntryDynDataModel[];
    this.logger.debug(
      `[VALIDATE] Starting validation for ${lines.length} lines`,
    );

    for (const line of lines) {
      this.validateDimensionsForLine(line, {
        dimensionIsRequired: {
          TruckerType: line.AccountType === 'Ledger',
        },
      });
    }

    return data;
  }
}
