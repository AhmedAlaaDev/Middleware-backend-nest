import { Command } from '@nestjs/cqrs';

export class SyncPaymentTermsCommand extends Command<{
  paymentTermsCreated: number;
  paymentTermsUpdated: number;
}> {
  constructor(public readonly company: string) {
    super();
  }
}
