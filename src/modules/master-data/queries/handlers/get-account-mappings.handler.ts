import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IAccountCustomerInvoiceMapping } from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetAccountMappingsQuery)
export class GetAccountMappingsHandler implements IQueryHandler<GetAccountMappingsQuery> {
  private readonly logger = new Logger(GetAccountMappingsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetAccountMappingsQuery,
  ): Promise<IPaginatedRes<IAccountCustomerInvoiceMapping>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    this.logger.log(
      `Fetching account mappings from database${query.filter?.serviceType ? ` for service type: ${query.filter.serviceType}` : ''}`,
    );

    const { items, total } =
      await this.masterDataService.getAccountMappingsAsync(
        query.filter ?? {},
        skipCount,
        maxCount,
      );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
