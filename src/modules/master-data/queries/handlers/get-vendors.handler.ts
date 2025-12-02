import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { Vendor } from '../get-vendors.query';
import { GetVendorsQuery } from '../get-vendors.query';

@QueryHandler(GetVendorsQuery)
export class GetVendorsHandler
  implements IQueryHandler<GetVendorsQuery>
{
  private readonly logger = new Logger(GetVendorsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetVendorsQuery): Promise<Vendor[]> {
    this.logger.log(
      `Fetching vendors from database${query.company ? ` for company: ${query.company}` : ''}`,
    );

    const filter = query.company ? { company: query.company } : {};
    const vendors = await this.db.vendorModel.find(filter).lean();

    return vendors.map((v: any) => ({
      id: v._id.toString(),
      company: v.company,
      vendorAccountNumber: v.vendorAccountNumber,
      vendorOrganizationName: v.vendorOrganizationName,
      vendorSearchName: v.vendorSearchName,
      vendorGroupId: v.vendorGroupId,
      currencyCode: v.currencyCode,
      defaultPaymentTermsName: v.defaultPaymentTermsName,
      salesTaxGroupCode: v.salesTaxGroupCode,
      onHoldStatus: v.onHoldStatus,
    }));
  }
}

