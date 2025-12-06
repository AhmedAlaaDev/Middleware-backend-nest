import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IBillingClassification } from '@/modules/master-data/interfaces/billing-classification.interface';
import { GetBillingClassificationsQuery } from '@/modules/master-data/queries/get-billing-classifications.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetBillingClassificationsQuery)
export class GetBillingClassificationsHandler implements IQueryHandler<GetBillingClassificationsQuery> {
  private readonly logger = new Logger(GetBillingClassificationsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetBillingClassificationsQuery,
  ): Promise<IBillingClassification[]> {
    this.logger.log(
      `Fetching billing classifications from database${query.company ? ` for company: ${query.company}` : ''}`,
    );

    const { items } =
      await this.masterDataService.getBillingClassificationsAsync({
        company: query.company,
      });

    return items;
  }
}
