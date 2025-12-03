import { Query } from '@nestjs/cqrs';

export interface BillingCode {
  id: string;
  dataAreaId: string;
  billingCode: string;
  billingClassification: string;
}

export class GetBillingCodesQuery extends Query<BillingCode[]> {
  constructor(
    public readonly company?: string,
    public readonly billingClassification?: string,
  ) {
    super();
  }
}
