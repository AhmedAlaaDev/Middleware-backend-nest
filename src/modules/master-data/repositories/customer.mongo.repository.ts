import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateCustomer,
  ICustomer,
  ICustomerListFilter,
} from '@/modules/master-data/interfaces/customer.interface';
import { CustomerRepository } from '@/modules/master-data/repositories/interfaces/customer.repository';
import { Customer } from '@/modules/master-data/schemas/customer.schema';

@Injectable()
export class CustomerMongoRepository implements CustomerRepository {
  constructor(
    @InjectModel(Customer.name)
    private readonly model: Model<Customer>,
  ) {}

  async upsertMany(
    company: string,
    customers: ICreateCustomer[],
  ): Promise<void> {
    const ops = customers.map((c) => ({
      updateOne: {
        filter: { company, customerAccount: c.customerAccount },
        update: { $set: { ...c, company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: ICustomerListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<ICustomer[]> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.searchTerm) {
      q['$or'] = [
        { customerAccount: { $regex: filter.searchTerm, $options: 'i' } },
        { name: { $regex: filter.searchTerm, $options: 'i' } },
        { nameAlias: { $regex: filter.searchTerm, $options: 'i' } },
        { taxExemptNumber: { $regex: filter.searchTerm, $options: 'i' } },
      ] as unknown;
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
      company: doc.company,
      customerAccount: doc.customerAccount,
      name: doc.name,
      organizationPhoneticName: doc.organizationPhoneticName,
      nameAlias: doc.nameAlias,
      customerGroupId: doc.customerGroupId,
      salesCurrencyCode: doc.salesCurrencyCode,
      invoiceAccount: doc.invoiceAccount,
      partyNumber: doc.partyNumber,
      organizationNumber: doc.organizationNumber,
      taxExemptNumber: doc.taxExemptNumber,
      defaultDimensionDisplayValue: doc.defaultDimensionDisplayValue,
    }));
  }

  async getCount(filter: ICustomerListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.searchTerm) {
      q['$or'] = [
        { customerAccount: { $regex: filter.searchTerm, $options: 'i' } },
        { name: { $regex: filter.searchTerm, $options: 'i' } },
        { nameAlias: { $regex: filter.searchTerm, $options: 'i' } },
        { taxExemptNumber: { $regex: filter.searchTerm, $options: 'i' } },
      ] as unknown;
    }
    return this.model.countDocuments(q).exec();
  }

  async findByAccount(
    company: string,
    customerAccount: string,
  ): Promise<ICustomer | null> {
    const doc = await this.model
      .findOne({ company, customerAccount })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      company: doc.company,
      customerAccount: doc.customerAccount,
      name: doc.name,
      organizationPhoneticName: doc.organizationPhoneticName,
      nameAlias: doc.nameAlias,
      customerGroupId: doc.customerGroupId,
      salesCurrencyCode: doc.salesCurrencyCode,
      invoiceAccount: doc.invoiceAccount,
      partyNumber: doc.partyNumber,
      organizationNumber: doc.organizationNumber,
      taxExemptNumber: doc.taxExemptNumber,
      defaultDimensionDisplayValue: doc.defaultDimensionDisplayValue,
    };
  }

  async deleteByCompany(company: string): Promise<void> {
    await this.model.deleteMany({ company }).exec();
  }
}
