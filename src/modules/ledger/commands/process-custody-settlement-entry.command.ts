import { Command } from '@nestjs/cqrs';

export class ProcessCustodySettlementEntryCommand extends Command<any> {
  constructor(
    public readonly companyId: string,
    public readonly fileBuffer?: Buffer,
    public readonly rawData?: any[],
  ) {
    super();
  }
}
