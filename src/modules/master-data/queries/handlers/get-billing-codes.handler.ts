import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { GetBillingCodesQuery, BillingCode } from '../get-billing-codes.query';

@QueryHandler(GetBillingCodesQuery)
export class GetBillingCodesHandler
  implements IQueryHandler<GetBillingCodesQuery>
{
  private readonly logger = new Logger(GetBillingCodesHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetBillingCodesQuery): Promise<BillingCode[]> {
    this.logger.log(
      `Fetching billing codes from database${query.company ? ` for company: ${query.company}` : ''}${query.billingClassification ? `, classification: ${query.billingClassification}` : ''}`,
    );

    const filter: any = {};
    if (query.company) {
      filter.dataAreaId = query.company;
    }
    if (query.billingClassification) {
      filter.billingClassification = query.billingClassification;
    }

    const codes = await this.db.billingCodeModel.find(filter).lean();

    return codes.map((c: any) => ({
      id: c._id.toString(),
      dataAreaId: c.dataAreaId,
      billingCode: c.billingCode,
      billingClassification: c.billingClassification,
    }));
  }
}

