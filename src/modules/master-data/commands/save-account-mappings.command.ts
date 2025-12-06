import { Command } from '@nestjs/cqrs';

import { ICreateAccountCustomerInvoiceMapping } from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';

export class SaveAccountMappingsCommand extends Command<{
  mappingsCreated: number;
  mappingsUpdated: number;
}> {
  constructor(
    public readonly mappings: ICreateAccountCustomerInvoiceMapping[],
  ) {
    super();
  }
}
