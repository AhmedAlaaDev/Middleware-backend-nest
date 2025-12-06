import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { ICustomer } from '@/modules/master-data/interfaces/customer.interface';
import { GetCustomersQuery } from '@/modules/master-data/queries/get-customers.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetCustomersQuery)
export class GetCustomersHandler implements IQueryHandler<GetCustomersQuery> {
  private readonly logger = new Logger(GetCustomersHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetCustomersQuery): Promise<ICustomer[]> {
    this.logger.log(
      `Fetching customers from database${query.company ? ` for company: ${query.company}` : ''}${query.searchTerm ? `, search term: ${query.searchTerm}` : ''}`,
    );

    const { items } = await this.masterDataService.getCustomersAsync({
      company: query.company,
      searchTerm: query.searchTerm,
    });

    return items;
  }
}
