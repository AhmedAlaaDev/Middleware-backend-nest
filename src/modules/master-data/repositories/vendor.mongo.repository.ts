import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateVendor,
  IVendor,
  IVendorListFilter,
} from '@/modules/master-data/interfaces/vendor.interface';
import { VendorRepository } from '@/modules/master-data/repositories/interfaces/vendor.repository';
import { Vendor } from '@/modules/master-data/schemas/vendor.schema';

@Injectable()
export class VendorMongoRepository implements VendorRepository {
  constructor(
    @InjectModel(Vendor.name)
    private readonly model: Model<Vendor>,
  ) {}

  async upsertMany(company: string, vendors: ICreateVendor[]): Promise<void> {
    const ops = vendors.map((v) => ({
      updateOne: {
        filter: { company, vendorAccountNumber: v.vendorAccountNumber },
        update: { $set: { ...v, company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IVendorListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IVendor[]> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.accountNumbers && filter.accountNumbers.length > 0) {
      q['vendorAccountNumber'] = { $in: filter.accountNumbers } as unknown;
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
      vendorAccountNumber: doc.vendorAccountNumber,
      vendorOrganizationName: doc.vendorOrganizationName,
      vendorSearchName: doc.vendorSearchName,
      vendorGroupId: doc.vendorGroupId,
      currencyCode: doc.currencyCode,
      defaultPaymentTermsName: doc.defaultPaymentTermsName,
      salesTaxGroupCode: doc.salesTaxGroupCode,
      onHoldStatus: doc.onHoldStatus,
    }));
  }

  async getCount(filter: IVendorListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.accountNumbers && filter.accountNumbers.length > 0) {
      q['vendorAccountNumber'] = { $in: filter.accountNumbers } as unknown;
    }
    return this.model.countDocuments(q).exec();
  }

  async findByAccount(
    company: string,
    vendorAccountNumber: string,
  ): Promise<IVendor | null> {
    const doc = await this.model
      .findOne({ company, vendorAccountNumber })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      company: doc.company,
      vendorAccountNumber: doc.vendorAccountNumber,
      vendorOrganizationName: doc.vendorOrganizationName,
      vendorSearchName: doc.vendorSearchName,
      vendorGroupId: doc.vendorGroupId,
      currencyCode: doc.currencyCode,
      defaultPaymentTermsName: doc.defaultPaymentTermsName,
      salesTaxGroupCode: doc.salesTaxGroupCode,
      onHoldStatus: doc.onHoldStatus,
    };
  }

  async deleteByCompany(company: string): Promise<void> {
    await this.model.deleteMany({ company }).exec();
  }
}
