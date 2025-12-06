import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IAccountCustomerInvoiceMapping } from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetAccountMappingsQuery)
export class GetAccountMappingsHandler implements IQueryHandler<GetAccountMappingsQuery> {
  private readonly logger = new Logger(GetAccountMappingsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetAccountMappingsQuery,
  ): Promise<IAccountCustomerInvoiceMapping[]> {
    this.logger.log(
      `Fetching account mappings from database${query.serviceType ? ` for service type: ${query.serviceType}` : ''}`,
    );

    const { items } = await this.masterDataService.getAccountMappingsAsync({
      serviceType: query.serviceType,
    });

    return items;
  }
}
