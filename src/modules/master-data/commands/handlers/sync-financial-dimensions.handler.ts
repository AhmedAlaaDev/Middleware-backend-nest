import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { SyncFinancialDimensionsCommand } from '../sync-financial-dimensions.command';

import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import {
  D365FODimension,
  D365FODimensionValue,
} from '@/modules/d365fo/types/d365fo-dimension.type';
import { DBService } from '@/modules/db/db.service';

@CommandHandler(SyncFinancialDimensionsCommand)
export class SyncFinancialDimensionsHandler implements ICommandHandler<SyncFinancialDimensionsCommand> {
  private readonly logger = new Logger(SyncFinancialDimensionsHandler.name);

  constructor(
    private readonly dimensionService: DimensionService,
    private readonly db: DBService,
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

    // Process each dimension
    for (const dim of allDimensions) {
      const dimensionName =
        dim.DimensionName || dim.Name || dim.DimensionAttributeName || '';

      if (!dimensionName) {
        this.logger.warn('Skipping dimension with no name', dim);
        continue;
      }

      // Check if dimension exists in database - upsert logic
      const existingDimension = await this.db.financialDimensionModel.findOne({
        financialKey: dimensionName,
      });

      if (!existingDimension) {
        // Create new dimension
        await this.db.financialDimensionModel.create({
          financialKey: dimensionName,
        });
        dimensionsCreated++;
        this.logger.debug(`Created dimension: ${dimensionName}`);
      } else {
        // Dimension already exists - no update needed as we only store the key
        // But we count it as processed for consistency
        dimensionsUpdated++;
      }

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
          // Create new dimension value
          await this.db.financialDimensionValueModel.create({
            financialDimensionKey: dimensionName,
            value: value,
            description: description,
          });
          dimensionValuesCreated++;
        } else {
          // Update existing dimension value if description changed
          if (existingValue.description !== description) {
            existingValue.description = description;
            await existingValue.save();
            dimensionValuesUpdated++;
            this.logger.debug(
              `Updated dimension value: ${dimensionName}/${value}`,
            );
          }
        }
      }
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
}
