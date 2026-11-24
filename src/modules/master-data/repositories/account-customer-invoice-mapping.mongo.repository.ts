import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { LEGACY_COMPANY_CODE } from '@/modules/master-data/company-run-config';
import {
  IAccountCustomerInvoiceMapping,
  ICreateAccountCustomerInvoiceMapping,
  IAccountCustomerInvoiceMappingFilter,
} from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';
import { AccountCustomerInvoiceMappingRepository } from '@/modules/master-data/repositories/interfaces/account-customer-invoice-mapping.repository';
import { AccountCustomerInvoiceMapping } from '@/modules/master-data/schemas/account-customer-invoice-mapping.schema';

@Injectable()
export class AccountCustomerInvoiceMappingMongoRepository implements AccountCustomerInvoiceMappingRepository {
  constructor(
    @InjectModel(AccountCustomerInvoiceMapping.name)
    private readonly model: Model<AccountCustomerInvoiceMapping>,
  ) {}

  async upsertMany(
    mappings: ICreateAccountCustomerInvoiceMapping[],
  ): Promise<void> {
    // Mappings are unique per company. M-P also owns legacy rows without a company.
    const ops = mappings.map((m) => {
      const company = m.company ?? LEGACY_COMPANY_CODE;
      const owner =
        company === LEGACY_COMPANY_CODE
          ? {
              $or: [
                { company },
                { company: { $exists: false } },
                { company: null },
              ],
            }
          : { company };
      return {
        updateOne: {
          filter: { name: m.name, serviceType: m.serviceType, ...owner },
          update: { $set: { ...m, company } },
          upsert: true,
        },
      };
    });
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IAccountCustomerInvoiceMappingFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IAccountCustomerInvoiceMapping[]> {
    const q: Record<string, unknown> = {};

    if (filter.serviceType !== undefined) {
      q['serviceType'] = filter.serviceType;
    }

    if (filter.company !== undefined) {
      // Legacy mappings were saved before company existed. They belong to m-p only.
      q['$or'] =
        filter.company === 'm-p'
          ? [
              { company: 'm-p' },
              { company: { $exists: false } },
              { company: null },
            ]
          : [{ company: filter.company }];
    }

    let query = this.model.find(q).lean();

    if (options?.skipCount !== undefined) {
      query = query.skip(options.skipCount);
    }

    if (options?.maxCount !== undefined) {
      query = query.limit(options.maxCount);
    }

    const docs = await query.exec();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      customerAccount: doc.customerAccount,
      invoiceAccount: doc.invoiceAccount,
      serviceType: doc.serviceType,
    }));
  }

  async getCount(
    filter: IAccountCustomerInvoiceMappingFilter,
  ): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.serviceType !== undefined) q['serviceType'] = filter.serviceType;
    return this.model.countDocuments(q).exec();
  }
}
