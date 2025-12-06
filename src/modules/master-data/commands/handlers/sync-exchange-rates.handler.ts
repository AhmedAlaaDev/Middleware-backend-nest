import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { D365FOExchangeRate } from '@/modules/d365fo/types';
import { SyncExchangeRatesCommand } from '@/modules/master-data/commands/sync-exchange-rates.command';
import { ICreateExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncExchangeRatesCommand)
export class SyncExchangeRatesHandler implements ICommandHandler<SyncExchangeRatesCommand> {
  private readonly logger = new Logger(SyncExchangeRatesHandler.name);

  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly masterDataService: MasterDataService,
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

    const existing = await this.masterDataService.getExchangeRatesAsync({
      rateTypeName: command.rateType,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((er) => {
      const key = `${er.rateTypeName}|${er.fromCurrency}|${er.toCurrency}|${new Date(
        er.startDate,
      ).toISOString()}`;
      existingMap.set(key, true);
    });

    const exchangeRatePayload: ICreateExchangeRate[] = [];

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

      const key = `${rateTypeName}|${fromCurrency}|${toCurrency}|${startDate.toISOString()}`;
      if (existingMap.has(key)) {
        exchangeRatesUpdated++;
      } else {
        exchangeRatesCreated++;
        existingMap.set(key, true);
      }

      exchangeRatePayload.push(exchangeRateData);
    }

    if (exchangeRatePayload.length > 0) {
      await this.masterDataService.upsertExchangeRatesAsync(
        exchangeRatePayload,
      );
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
