import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import {
  D365FODimension,
  D365FODimensionValue,
} from '@/modules/d365fo/types/d365fo-dimension.type';
import { SyncFinancialDimensionsCommand } from '@/modules/master-data/commands/sync-financial-dimensions.command';
import {
  ICreateFinancialDimension,
  ICreateFinancialDimensionValue,
} from '@/modules/master-data/interfaces/financial-dimension.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncFinancialDimensionsCommand)
export class SyncFinancialDimensionsHandler implements ICommandHandler<SyncFinancialDimensionsCommand> {
  private readonly logger = new Logger(SyncFinancialDimensionsHandler.name);

  constructor(
    private readonly dimensionService: DimensionService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncFinancialDimensionsCommand): Promise<{
    dimensionsCreated: number;
    dimensionsUpdated: number;
    dimensionValuesCreated: number;
    dimensionValuesUpdated: number;
  }> {
    this.logger.log(
      `Syncing financial dimensions from D365FO${command.company ? ` for company: ${command.company}` : ''}`,
    );

    let dimensionsCreated = 0;
    let dimensionsUpdated = 0;
    let dimensionValuesCreated = 0;
    let dimensionValuesUpdated = 0;

    // Fetch all dimensions from D365FO using pagination
    const allDimensions: D365FODimension[] = [];
    let skipCount = 0;
    const pageSize = 5000;
    let hasMore = true;

    while (hasMore) {
      const response = await this.dimensionService.getDimensionList({
        useCache: false, // Don't use cache for sync operations
        maxCount: pageSize,
        skipCount: skipCount,
      });

      // Response is always in D365FOODataResponse format
      const dimensions = Array.isArray(response.value) ? response.value : [];

      if (dimensions.length === 0) {
        hasMore = false;
      } else {
        allDimensions.push(...dimensions);
        skipCount += pageSize;
        // If we got less than pageSize, we've reached the end
        if (dimensions.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.log(`Fetched ${allDimensions.length} dimensions from D365FO`);

    const existingDimensions =
      await this.masterDataService.getFinancialDimensionsAsync();
    const dimensionMap = new Map<string, boolean>();
    existingDimensions.forEach((d) =>
      dimensionMap.set(d.financialKey.toLowerCase(), true),
    );

    const dimensionPayload: ICreateFinancialDimension[] = [];
    const dimensionValuePayload: ICreateFinancialDimensionValue[] = [];

    // Process each dimension
    for (const dim of allDimensions) {
      const dimensionName =
        dim.DimensionName || dim.Name || dim.DimensionAttributeName || '';

      if (!dimensionName) {
        this.logger.warn('Skipping dimension with no name', dim);
        continue;
      }

      if (dimensionMap.has(dimensionName.toLowerCase())) {
        dimensionsUpdated++;
      } else {
        dimensionsCreated++;
        dimensionMap.set(dimensionName.toLowerCase(), true);
      }

      dimensionPayload.push({ financialKey: dimensionName });

      // Fetch all dimension values from D365FO using pagination
      const allDimensionValues: D365FODimensionValue[] = [];
      let valueSkipCount = 0;
      const valuePageSize = 10000;
      let hasMoreValues = true;

      while (hasMoreValues) {
        const response = await this.dimensionService.getDimensionValueList(
          dimensionName,
          command.company || '',
          {
            useCache: false,
            maxCount: valuePageSize,
            skipCount: valueSkipCount,
          },
        );

        // Response is always in D365FOODataResponse format
        const dimensionValues = Array.isArray(response.value)
          ? response.value
          : [];

        if (dimensionValues.length === 0) {
          hasMoreValues = false;
        } else {
          allDimensionValues.push(...dimensionValues);
          valueSkipCount += valuePageSize;
          // If we got less than pageSize, we've reached the end
          if (dimensionValues.length < valuePageSize) {
            hasMoreValues = false;
          }
        }
      }

      this.logger.debug(
        `Fetched ${allDimensionValues.length} values for dimension: ${dimensionName}`,
      );

      const existingValues =
        await this.masterDataService.getFinancialDimensionValuesAsync({
          financialDimensionKey: dimensionName,
        });
      const valueMap = new Map<string, boolean>();
      existingValues.forEach((v) => valueMap.set(v.value.toLowerCase(), true));

      // Insert dimension values if they don't exist
      for (const dv of allDimensionValues) {
        const value = dv.DimensionValue || dv.Value || '';
        const description = dv.Description || dv.Name || undefined;

        if (!value) {
          this.logger.warn(
            `Skipping dimension value with no value for dimension: ${dimensionName}`,
            dv,
          );
          continue;
        }

        if (valueMap.has(value.toLowerCase())) {
          dimensionValuesUpdated++;
        } else {
          dimensionValuesCreated++;
          valueMap.set(value.toLowerCase(), true);
        }

        dimensionValuePayload.push({
          financialDimensionKey: dimensionName,
          value: value,
          description: description,
          isSuspended: this.parseYesNo(dv.IsSuspended),
          isBlockedForManualEntry: this.parseYesNo(dv.IsBlockedForManualEntry),
          isTotal: this.parseYesNo(dv.IsTotal),
          activeFrom: this.parseOptionalDate(dv.ActiveFrom),
          activeTo: this.parseOptionalDate(dv.ActiveTo),
        });
      }
    }

    if (dimensionPayload.length > 0) {
      await this.masterDataService.upsertFinancialDimensionsAsync(
        dimensionPayload,
      );
    }

    if (dimensionValuePayload.length > 0) {
      await this.masterDataService.upsertFinancialDimensionValuesAsync(
        dimensionValuePayload,
      );
    }

    this.logger.log(
      `Sync completed: ${dimensionsCreated} dimensions created, ${dimensionsUpdated} dimensions updated, ${dimensionValuesCreated} dimension values created, ${dimensionValuesUpdated} dimension values updated`,
    );

    return {
      dimensionsCreated,
      dimensionsUpdated,
      dimensionValuesCreated,
      dimensionValuesUpdated,
    };
  }

  private parseOptionalDate(dateText?: string): Date | undefined {
    if (!dateText) return undefined;
    const parsed = new Date(dateText);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private parseYesNo(value?: string): 'Yes' | 'No' | undefined {
    if (value === 'Yes' || value === 'No') return value;
    return undefined;
  }
}
