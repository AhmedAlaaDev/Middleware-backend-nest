import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { ITaxItemGroupHeading } from '@/modules/master-data/interfaces/tax-item-group-heading.interface';
import { GetTaxItemGroupHeadingsQuery } from '@/modules/master-data/queries/get-tax-item-group-headings.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetTaxItemGroupHeadingsQuery)
export class GetTaxItemGroupHeadingsHandler implements IQueryHandler<GetTaxItemGroupHeadingsQuery> {
  private readonly logger = new Logger(GetTaxItemGroupHeadingsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetTaxItemGroupHeadingsQuery,
  ): Promise<IPaginatedRes<ITaxItemGroupHeading>> {
    const { items, total } =
      await this.masterDataService.getTaxItemGroupHeadingsAsync(
        query.filter ?? {},
        query.skipCount,
        query.maxCount,
      );
    return new IPaginatedRes(items, total, query.maxCount, query.skipCount);
  }
}
