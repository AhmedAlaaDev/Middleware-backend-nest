import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { ICustomer } from '@/modules/master-data/interfaces/customer.interface';
import { GetCustomersQuery } from '@/modules/master-data/queries/get-customers.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetCustomersQuery)
export class GetCustomersHandler implements IQueryHandler<GetCustomersQuery> {
  private readonly logger = new Logger(GetCustomersHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetCustomersQuery,
  ): Promise<IPaginatedRes<ICustomer>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    this.logger.log(
      `Fetching customers from database${query.filter?.company ? ` for company: ${query.filter.company}` : ''}${query.filter?.searchTerm ? `, search term: ${query.filter.searchTerm}` : ''}`,
    );

    const { items, total } = await this.masterDataService.getCustomersAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
