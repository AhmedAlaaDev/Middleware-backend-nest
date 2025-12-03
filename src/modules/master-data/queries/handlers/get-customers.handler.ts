import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Customer, GetCustomersQuery } from '../get-customers.query';

import { DBService } from '@/modules/db/db.service';

@QueryHandler(GetCustomersQuery)
export class GetCustomersHandler implements IQueryHandler<GetCustomersQuery> {
  private readonly logger = new Logger(GetCustomersHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetCustomersQuery): Promise<Customer[]> {
    this.logger.log(
      `Fetching customers from database${query.company ? ` for company: ${query.company}` : ''}${query.searchTerm ? `, search term: ${query.searchTerm}` : ''}`,
    );

    const filter: any = {};
    if (query.company) {
      filter.company = query.company;
    }
    if (query.searchTerm) {
      filter.$or = [
        { customerAccount: { $regex: query.searchTerm, $options: 'i' } },
        { name: { $regex: query.searchTerm, $options: 'i' } },
        { nameAlias: { $regex: query.searchTerm, $options: 'i' } },
      ];
    }

    const customers = await this.db.customerModel.find(filter).lean();

    return customers.map((c: any) => ({
      id: c._id.toString(),
      company: c.company,
      customerAccount: c.customerAccount,
      name: c.name,
      organizationPhoneticName: c.organizationPhoneticName,
      nameAlias: c.nameAlias,
      customerGroupId: c.customerGroupId,
      salesCurrencyCode: c.salesCurrencyCode,
      invoiceAccount: c.invoiceAccount,
      partyNumber: c.partyNumber,
      organizationNumber: c.organizationNumber,
      defaultDimensionDisplayValue: c.defaultDimensionDisplayValue,
    }));
  }
}
