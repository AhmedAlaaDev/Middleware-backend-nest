import { Command } from '@nestjs/cqrs';

export interface AccountMappingData {
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: number;
}

export class SaveAccountMappingsCommand extends Command<{
  mappingsCreated: number;
  mappingsUpdated: number;
}> {
  constructor(public readonly mappings: AccountMappingData[]) {
    super();
  }
}

