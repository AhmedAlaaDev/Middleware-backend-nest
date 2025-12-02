import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { GetCustomersQuery } from '../get-customers.query';

@QueryHandler(GetCustomersQuery)
export class GetCustomersHandler implements IQueryHandler<GetCustomersQuery> {
  private readonly logger = new Logger(GetCustomersHandler.name);

  constructor(private readonly customerService: CustomerService) {}

  public async execute(query: GetCustomersQuery) {
    this.logger.log(
      `Fetching customers for company: ${query.company}${query.searchTerm ? `, search term: ${query.searchTerm}` : ''}`,
    );

    if (query.searchTerm) {
      return this.customerService.searchCustomers(query.company, query.searchTerm, {
        skipCount: query.skipCount,
        maxCount: query.maxCount,
        useCache: true,
      });
    }

    return this.customerService.getCustomerList(query.company, {
      skipCount: query.skipCount,
      maxCount: query.maxCount,
      useCache: true,
    });
  }
}

