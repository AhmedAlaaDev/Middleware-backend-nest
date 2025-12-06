import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetBillingCodesQuery)
export class GetBillingCodesHandler implements IQueryHandler<GetBillingCodesQuery> {
  private readonly logger = new Logger(GetBillingCodesHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetBillingCodesQuery): Promise<IBillingCode[]> {
    this.logger.log(
      `Fetching billing codes from database${query.company ? ` for company: ${query.company}` : ''}${query.billingClassification ? `, classification: ${query.billingClassification}` : ''}`,
    );

    const { items } = await this.masterDataService.getBillingCodesAsync({
      company: query.company,
      billingClassification: query.billingClassification,
    });

    return items;
  }
}
