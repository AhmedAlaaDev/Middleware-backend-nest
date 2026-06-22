import { Command } from '@nestjs/cqrs';

export class ProcessARShippingLinesCommand extends Command<any> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId: string,
  ) {
    super();
  }
}
