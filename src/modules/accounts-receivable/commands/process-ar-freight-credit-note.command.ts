import { Command } from '@nestjs/cqrs';

export class ProcessARFreightCreditNoteCommand extends Command<any> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId: string,
    public readonly billingCodeId?: string,
  ) {
    super();
  }
}

