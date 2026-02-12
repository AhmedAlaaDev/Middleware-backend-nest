import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';

@Injectable()
export class EntryProcessorBaseDependencies {
  constructor(
    public readonly queryBus: QueryBus,
    public readonly exchangeRateService: ExchangeRateService,
  ) {}
}
