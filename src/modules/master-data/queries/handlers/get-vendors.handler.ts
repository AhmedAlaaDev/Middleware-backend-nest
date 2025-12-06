import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IVendor } from '@/modules/master-data/interfaces/vendor.interface';
import { GetVendorsQuery } from '@/modules/master-data/queries/get-vendors.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetVendorsQuery)
export class GetVendorsHandler implements IQueryHandler<GetVendorsQuery> {
  private readonly logger = new Logger(GetVendorsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(query: GetVendorsQuery): Promise<IVendor[]> {
    this.logger.log(
      `Fetching vendors from database${query.company ? ` for company: ${query.company}` : ''}`,
    );

    const { items } = await this.masterDataService.getVendorsAsync({
      company: query.company,
    });

    return items;
  }
}
