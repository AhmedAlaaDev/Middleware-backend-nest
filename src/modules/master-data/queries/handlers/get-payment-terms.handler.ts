import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IPaymentTerm } from '@/modules/master-data/interfaces/payment-term.interface';
import { GetPaymentTermsQuery } from '@/modules/master-data/queries/get-payment-terms.query';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@QueryHandler(GetPaymentTermsQuery)
export class GetPaymentTermsHandler
  implements IQueryHandler<GetPaymentTermsQuery>
{
  private readonly logger = new Logger(GetPaymentTermsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(
    query: GetPaymentTermsQuery,
  ): Promise<IPaginatedRes<IPaymentTerm>> {
    const skipCount = query.skipCount;
    const maxCount = query.maxCount;

    const { items, total } = await this.masterDataService.getPaymentTermsAsync(
      query.filter ?? {},
      skipCount,
      maxCount,
    );

    return new IPaginatedRes(items, total, maxCount, skipCount);
  }
}
