import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetAccountMappingsQuery } from '../get-account-mappings.query';

import { DBService } from '@/modules/db/db.service';
import {
  AccountCustomerInvoiceMapping,
  ServiceTypes,
} from '@/modules/master-data/types/master-data.types';

@QueryHandler(GetAccountMappingsQuery)
export class GetAccountMappingsHandler implements IQueryHandler<GetAccountMappingsQuery> {
  private readonly logger = new Logger(GetAccountMappingsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetAccountMappingsQuery,
  ): Promise<AccountCustomerInvoiceMapping[]> {
    this.logger.log(
      `Fetching account mappings from database${query.serviceType ? ` for service type: ${query.serviceType}` : ''}`,
    );

    const filter = query.serviceType ? { serviceType: query.serviceType } : {};
    const mappings = await this.db.accountCustomerInvoiceMappingModel
      .find(filter)
      .lean();

    return mappings.map((m: any) => ({
      id: m._id.toString(),
      name: m.name,
      customerAccount: m.customerAccount,
      invoiceAccount: m.invoiceAccount,
      serviceType: m.serviceType as ServiceTypes,
    }));
  }
}
