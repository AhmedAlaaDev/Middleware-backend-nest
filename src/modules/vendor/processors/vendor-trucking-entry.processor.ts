import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryDynDataModel } from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { VendorEntryDynDataModel } from '@/modules/vendor/models';
import { VendorEntryRawDataModel } from '@/modules/vendor/models/vendor-entry-raw-data.model';
import { BaseVendorEntryProcessor } from '@/modules/vendor/processors/base-vendor-entry.processor';

@Injectable()
export class VendorTruckingEntryProcessor extends BaseVendorEntryProcessor {
  private readonly SOKHNA_BRANCH_CODE = '014';
  private readonly TRUCKING_COST_CENTER_CODE = '2101';
  private readonly SALESMAN_FALLBACK_COST_CENTER_CODES = ['2101', '2201'];
  private readonly DEFAULT_SALESMAN_CODE = '3149';
  private readonly DEFAULT_COORDINATOR_CODE = '3149';
  readonly entryProcessorType = EntryProcessorTypes.VendorTrucking;
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
    return 'V-Fleet';
  }

  protected getDescriptionPrefix(): string {
    return 'Vendor Invoice Fleet';
  }

  protected buildLine(
    sourceId: string,
    line: VendorEntryRawDataModel,
  ): VendorEntryDynDataModel {
    const dynLine = super.buildLine(sourceId, line);
    const dimensions = dynLine.DimensionModel;
    if (!dimensions) {
      return dynLine;
    }

    const costCenter = dimensions.costCenter?.trim();
    const isSokhnaTruckingEntry =
      dimensions.location?.trim() === this.SOKHNA_BRANCH_CODE &&
      costCenter === this.TRUCKING_COST_CENTER_CODE;
    const isSalesmanFallbackCostCenter =
      !!costCenter &&
      this.SALESMAN_FALLBACK_COST_CENTER_CODES.includes(costCenter);
    let dimensionsChanged = false;

    if (isSalesmanFallbackCostCenter && !dimensions.salesMan?.trim()) {
      dimensions.salesMan = this.DEFAULT_SALESMAN_CODE;
      dimensionsChanged = true;
    }

    if (isSokhnaTruckingEntry && !dimensions.coordinatorMan?.trim()) {
      dimensions.coordinatorMan = this.DEFAULT_COORDINATOR_CODE;
      dimensionsChanged = true;
    }

    if (!dimensionsChanged) {
      return dynLine;
    }

    const expectedSegments = this.utilsService.isValidDimensionSegmentLength(
      this.utilsService.getDimensionSegmentLength(
        this.isLedger(line)
          ? line.ACCOUNTDISPLAYVALUE
          : line.DEFAULTDIMENSIONDISPLAYVALUE,
      ),
    )
      ? this.utilsService.getDimensionSegmentLength(
          this.isLedger(line)
            ? line.ACCOUNTDISPLAYVALUE
            : line.DEFAULTDIMENSIONDISPLAYVALUE,
        )
      : 20;

    const normalizedDimensionString =
      this.utilsService.toDimensionStringWithSegments(
        dimensions,
        expectedSegments,
      );

    if (this.isLedger(line)) {
      dynLine.AccountDisplayValue = normalizedDimensionString;
    } else {
      dynLine.DefaultDimensionDisplayValue = normalizedDimensionString;
    }

    return dynLine;
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
