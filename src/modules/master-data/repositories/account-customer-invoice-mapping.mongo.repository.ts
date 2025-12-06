import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

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
    const ops = mappings.map((m) => ({
      updateOne: {
        filter: { name: m.name, serviceType: m.serviceType },
        update: { $set: m },
        upsert: true,
      },
    }));
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
