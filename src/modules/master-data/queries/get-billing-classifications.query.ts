import { Query } from '@nestjs/cqrs';

import { IBillingClassification } from '@/modules/master-data/interfaces/billing-classification.interface';

export class GetBillingClassificationsQuery extends Query<
  IBillingClassification[]
> {
  constructor(public readonly company?: string) {
    super();
  }
}
