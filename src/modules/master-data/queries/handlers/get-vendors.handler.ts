import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IVendor } from '@/modules/master-data/interfaces/vendor.interface';
import { GetVendorsQuery } from '@/modules/master-data/queries/get-vendors.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetVendorsQuery)
export class GetVendorsHandler implements IQueryHandler<GetVendorsQuery> {
  private readonly logger = new Logger(GetVendorsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetVendorsQuery,
  ): Promise<IPaginatedRes<IVendor>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    // this.logger.log(
    //   `Fetching vendors from database${query.filter?.company ? ` for company: ${query.filter.company}` : ''}`,
    // );

    const { items, total } = await this.masterDataService.getVendorsAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
