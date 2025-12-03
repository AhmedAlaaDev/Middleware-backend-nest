import { Command } from '@nestjs/cqrs';

import { ServiceTypes } from '@/modules/master-data/types/master-data.types';

export interface AccountMappingData {
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
}

export class SaveAccountMappingsCommand extends Command<{
  mappingsCreated: number;
  mappingsUpdated: number;
}> {
  constructor(public readonly mappings: AccountMappingData[]) {
    super();
  }
}
