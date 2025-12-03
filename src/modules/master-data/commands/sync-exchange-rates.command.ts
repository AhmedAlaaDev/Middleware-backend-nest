import { Command } from '@nestjs/cqrs';

export class SyncExchangeRatesCommand extends Command<{
  exchangeRatesCreated: number;
  exchangeRatesUpdated: number;
}> {
  constructor(
    public readonly company: string,
    public readonly rateType?: string,
  ) {
    super();
  }
}
