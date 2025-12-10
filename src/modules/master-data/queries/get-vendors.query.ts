import { Query } from '@nestjs/cqrs';

import {
  IVendor,
  IVendorListFilter,
} from '@/modules/master-data/interfaces/vendor.interface';

export class GetVendorsQuery extends Query<IVendor[]> {
  constructor(
    public readonly filter?: IVendorListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
