import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IBillingClassification } from '@/modules/master-data/interfaces/billing-classification.interface';
import { GetBillingClassificationsQuery } from '@/modules/master-data/queries/get-billing-classifications.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetBillingClassificationsQuery)
export class GetBillingClassificationsHandler implements IQueryHandler<GetBillingClassificationsQuery> {
  private readonly logger = new Logger(GetBillingClassificationsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetBillingClassificationsQuery,
  ): Promise<IPaginatedRes<IBillingClassification>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    this.logger.log(
      `Fetching billing classifications from database${query.filter?.company ? ` for company: ${query.filter.company}` : ''}`,
    );

    const { items, total } =
      await this.masterDataService.getBillingClassificationsAsync(
        query.filter ?? {},
        skipCount,
        maxCount,
      );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
