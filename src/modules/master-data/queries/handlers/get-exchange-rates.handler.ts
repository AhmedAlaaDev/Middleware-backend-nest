import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { ExchangeRate } from '../get-exchange-rates.query';
import { GetExchangeRatesQuery } from '../get-exchange-rates.query';

@QueryHandler(GetExchangeRatesQuery)
export class GetExchangeRatesHandler
  implements IQueryHandler<GetExchangeRatesQuery>
{
  private readonly logger = new Logger(GetExchangeRatesHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetExchangeRatesQuery): Promise<ExchangeRate[]> {
    this.logger.log(
      `Fetching exchange rates from database${query.rateType ? `, rateType: ${query.rateType}` : ''}${query.fromCurrency ? `, fromCurrency: ${query.fromCurrency}` : ''}${query.toCurrency ? `, toCurrency: ${query.toCurrency}` : ''}`,
    );

    const filter: any = {};
    if (query.rateType) {
      filter.rateTypeName = query.rateType;
    }
    if (query.fromCurrency) {
      filter.fromCurrency = query.fromCurrency;
    }
    if (query.toCurrency) {
      filter.toCurrency = query.toCurrency;
    }
    if (query.fromDate) {
      filter.startDate = { $gte: query.fromDate };
    }
    if (query.toDate) {
      filter.endDate = { $lte: query.toDate };
    }

    const exchangeRates = await this.db.exchangeRateModel.find(filter).lean();

    return exchangeRates.map((er: any) => ({
      id: er._id.toString(),
      rateTypeName: er.rateTypeName,
      fromCurrency: er.fromCurrency,
      toCurrency: er.toCurrency,
      startDate: er.startDate.toISOString(),
      rate: er.rate,
      endDate: er.endDate.toISOString(),
      conversionFactor: er.conversionFactor,
      rateTypeDescription: er.rateTypeDescription,
    }));
  }
}

