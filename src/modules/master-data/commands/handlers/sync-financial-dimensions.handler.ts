import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import {
  D365FODimension,
  D365FODimensionValue,
} from '@/modules/d365fo/types/d365fo-dimension.type';
import { D365FOODataResponse } from '@/modules/d365fo/types/d365fo-odata.type';
import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import { DBService } from '@/modules/db/db.service';
import { SyncFinancialDimensionsCommand } from '../sync-financial-dimensions.command';

@CommandHandler(SyncFinancialDimensionsCommand)
export class SyncFinancialDimensionsHandler
  implements ICommandHandler<SyncFinancialDimensionsCommand>
{
  private readonly logger = new Logger(SyncFinancialDimensionsHandler.name);

  constructor(
    private readonly dimensionService: DimensionService,
    private readonly db: DBService,
  ) {}

  public async execute(
    command: SyncFinancialDimensionsCommand,
  ): Promise<{ dimensionsCreated: number; dimensionValuesCreated: number }> {
    this.logger.log(
      `Syncing financial dimensions from D365FO${command.company ? ` for company: ${command.company}` : ''}`,
    );

    let dimensionsCreated = 0;
    let dimensionValuesCreated = 0;

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
      const dimensions = Array.isArray(response.value)
        ? response.value
        : [];

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

    // Process each dimension
    for (const dim of allDimensions) {
      const dimensionName = dim.DimensionName || dim.Name || dim.DimensionAttributeName || '';

      if (!dimensionName) {
        this.logger.warn('Skipping dimension with no name', dim);
        continue;
      }

      // Check if dimension exists in database
      const existingDimension =
        await this.db.financialDimensionModel.findOne({
          financialKey: dimensionName,
        });

      if (!existingDimension) {
        // Create new dimension
        await this.db.financialDimensionModel.create({
          financialKey: dimensionName,
        });
        dimensionsCreated++;
        this.logger.debug(`Created dimension: ${dimensionName}`);
      }

      // Fetch all dimension values from D365FO using pagination
      const allDimensionValues: D365FODimensionValue[] = [];
      let valueSkipCount = 0;
      const valuePageSize = 10000;
      let hasMoreValues = true;

      while (hasMoreValues) {
        const response =
          await this.dimensionService.getDimensionValueList(
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

        const existingValue =
          await this.db.financialDimensionValueModel.findOne({
            financialDimensionKey: dimensionName,
            value: value,
          });

        if (!existingValue) {
          await this.db.financialDimensionValueModel.create({
            financialDimensionKey: dimensionName,
            value: value,
            description: description,
          });
          dimensionValuesCreated++;
        }
      }
    }

    this.logger.log(
      `Sync completed: ${dimensionsCreated} dimensions created, ${dimensionValuesCreated} dimension values created`,
    );

    return {
      dimensionsCreated,
      dimensionValuesCreated,
    };
  }
}

