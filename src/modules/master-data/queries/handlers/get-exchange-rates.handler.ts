import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';
import { GetExchangeRatesQuery } from '@/modules/master-data/queries/get-exchange-rates.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetExchangeRatesQuery)
export class GetExchangeRatesHandler implements IQueryHandler<GetExchangeRatesQuery> {
  private readonly logger = new Logger(GetExchangeRatesHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetExchangeRatesQuery,
  ): Promise<IPaginatedRes<IExchangeRate>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    // this.logger.log(
    //   `Fetching exchange rates from database${query.rateType ? `, rateType: ${query.rateType}` : ''}${query.fromCurrency ? `, fromCurrency: ${query.fromCurrency}` : ''}${query.toCurrency ? `, toCurrency: ${query.toCurrency}` : ''}`,
    // );

    const { items, total } = await this.masterDataService.getExchangeRatesAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
