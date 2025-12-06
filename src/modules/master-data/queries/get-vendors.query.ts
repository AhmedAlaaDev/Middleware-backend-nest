import { Query } from '@nestjs/cqrs';

import { IVendor } from '@/modules/master-data/interfaces/vendor.interface';

export class GetVendorsQuery extends Query<IVendor[]> {
  constructor(public readonly company?: string) {
    super();
  }
}
