import { Query } from '@nestjs/cqrs';

import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';

export class GetBillingCodesQuery extends Query<IBillingCode[]> {
  constructor(
    public readonly company?: string,
    public readonly billingClassification?: string,
  ) {
    super();
  }
}
