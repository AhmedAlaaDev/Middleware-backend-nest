import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';
import { GetExchangeRatesQuery } from '@/modules/master-data/queries/get-exchange-rates.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetExchangeRatesQuery)
export class GetExchangeRatesHandler implements IQueryHandler<GetExchangeRatesQuery> {
  private readonly logger = new Logger(GetExchangeRatesHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetExchangeRatesQuery): Promise<IExchangeRate[]> {
    this.logger.log(
      `Fetching exchange rates from database${query.rateType ? `, rateType: ${query.rateType}` : ''}${query.fromCurrency ? `, fromCurrency: ${query.fromCurrency}` : ''}${query.toCurrency ? `, toCurrency: ${query.toCurrency}` : ''}`,
    );

    const { items } = await this.masterDataService.getExchangeRatesAsync({
      rateTypeName: query.rateType,
      fromCurrency: query.fromCurrency,
      toCurrency: query.toCurrency,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
    });

    return items;
  }
}
