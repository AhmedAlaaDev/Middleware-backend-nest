import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetBillingCodesQuery)
export class GetBillingCodesHandler implements IQueryHandler<GetBillingCodesQuery> {
  private readonly logger = new Logger(GetBillingCodesHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetBillingCodesQuery,
  ): Promise<IPaginatedRes<IBillingCode>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    this.logger.log(
      `Fetching billing codes from database${query.filter?.company ? ` for company: ${query.filter.company}` : ''}${query.filter?.billingClassification ? `, classification: ${query.filter.billingClassification}` : ''}`,
    );

    const { items, total } = await this.masterDataService.getBillingCodesAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
