import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { ILedger } from '@/modules/master-data/interfaces/ledger.interface';
import { GetLedgersQuery } from '@/modules/master-data/queries/get-ledgers.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetLedgersQuery)
export class GetLedgersHandler implements IQueryHandler<GetLedgersQuery> {
  private readonly logger = new Logger(GetLedgersHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetLedgersQuery,
  ): Promise<IPaginatedRes<ILedger>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    const { items, total } = await this.masterDataService.getLedgersAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
