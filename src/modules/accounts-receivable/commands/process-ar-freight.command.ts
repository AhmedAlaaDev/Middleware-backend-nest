import { Command } from '@nestjs/cqrs';

export class ProcessARFreightCommand extends Command<any> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId: string,
    public readonly billingCodeId?: string,
  ) {
    super();
  }
}
