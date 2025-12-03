import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { SyncExchangeRatesCommand } from '../sync-exchange-rates.command';

import { ExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { D365FOExchangeRate } from '@/modules/d365fo/types';
import { DBService } from '@/modules/db/db.service';

@CommandHandler(SyncExchangeRatesCommand)
export class SyncExchangeRatesHandler implements ICommandHandler<SyncExchangeRatesCommand> {
  private readonly logger = new Logger(SyncExchangeRatesHandler.name);

  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly db: DBService,
  ) {}

  public async execute(command: SyncExchangeRatesCommand): Promise<{
    exchangeRatesCreated: number;
    exchangeRatesUpdated: number;
  }> {
    this.logger.log(
      `Syncing exchange rates from D365FO for company: ${command.company}, rateType: ${command.rateType || 'Default'}`,
    );

    let exchangeRatesCreated = 0;
    let exchangeRatesUpdated = 0;

    // Fetch all exchange rates from D365FO using pagination
    const allExchangeRates: D365FOExchangeRate[] = [];
    let skipCount = 0;
    const pageSize = 250;
    let hasMore = true;

    while (hasMore) {
      const exchangeRates = await this.exchangeRateService.getExchangeRates(
        command.company,
        {
          rateType: command.rateType,
          useCache: false, // Don't use cache for sync operations
          maxCount: pageSize,
          skipCount: skipCount,
        },
      );

      if (exchangeRates.length === 0) {
        hasMore = false;
      } else {
        allExchangeRates.push(...exchangeRates);
        skipCount += pageSize;
        if (exchangeRates.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.log(
      `Fetched ${allExchangeRates.length} exchange rates from D365FO`,
    );

    // Process each exchange rate
    for (const exchangeRate of allExchangeRates) {
      const rateTypeName = exchangeRate.RateTypeName || '';
      const fromCurrency = exchangeRate.FromCurrency || '';
      const toCurrency = exchangeRate.ToCurrency || '';
      const startDate = exchangeRate.StartDate
        ? new Date(exchangeRate.StartDate)
        : null;

      if (!rateTypeName || !fromCurrency || !toCurrency || !startDate) {
        this.logger.warn(
          'Skipping exchange rate with missing required fields',
          exchangeRate,
        );
        continue;
      }

      // Check if exchange rate exists in database - upsert logic
      const existingExchangeRate = await this.db.exchangeRateModel.findOne({
        rateTypeName: rateTypeName,
        fromCurrency: fromCurrency,
        toCurrency: toCurrency,
        startDate: startDate,
      });

      const exchangeRateData = {
        rateTypeName: rateTypeName,
        fromCurrency: fromCurrency,
        toCurrency: toCurrency,
        startDate: startDate,
        rate: exchangeRate.Rate || 0,
        endDate: exchangeRate.EndDate
          ? new Date(exchangeRate.EndDate)
          : startDate,
        conversionFactor: exchangeRate.ConversionFactor,
        rateTypeDescription: exchangeRate.RateTypeDescription,
      };

      if (!existingExchangeRate) {
        // Create new exchange rate
        await this.db.exchangeRateModel.create(exchangeRateData);
        exchangeRatesCreated++;
        this.logger.debug(
          `Created exchange rate: ${rateTypeName}/${fromCurrency}->${toCurrency}/${startDate.toISOString()}`,
        );
      } else {
        // Update existing exchange rate if data changed
        let hasChanges = false;
        if (existingExchangeRate.rate !== exchangeRateData.rate) {
          existingExchangeRate.rate = exchangeRateData.rate;
          hasChanges = true;
        }
        if (
          existingExchangeRate.endDate.getTime() !==
          exchangeRateData.endDate.getTime()
        ) {
          existingExchangeRate.endDate = exchangeRateData.endDate;
          hasChanges = true;
        }
        if (
          existingExchangeRate.conversionFactor !==
          exchangeRateData.conversionFactor
        ) {
          existingExchangeRate.conversionFactor =
            exchangeRateData.conversionFactor;
          hasChanges = true;
        }
        if (
          existingExchangeRate.rateTypeDescription !==
          exchangeRateData.rateTypeDescription
        ) {
          existingExchangeRate.rateTypeDescription =
            exchangeRateData.rateTypeDescription;
          hasChanges = true;
        }

        if (hasChanges) {
          await existingExchangeRate.save();
          exchangeRatesUpdated++;
          this.logger.debug(
            `Updated exchange rate: ${rateTypeName}/${fromCurrency}->${toCurrency}/${startDate.toISOString()}`,
          );
        }
      }
    }

    this.logger.log(
      `Sync completed: ${exchangeRatesCreated} exchange rates created, ${exchangeRatesUpdated} exchange rates updated`,
    );

    return {
      exchangeRatesCreated,
      exchangeRatesUpdated,
    };
  }
}
