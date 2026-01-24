import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreatePaymentTerm,
  IPaymentTerm,
  IPaymentTermListFilter,
} from '@/modules/master-data/interfaces/payment-term.interface';
import { PaymentTermRepository } from '@/modules/master-data/repositories/interfaces/payment-term.repository';
import { PaymentTerm } from '@/modules/master-data/schemas/payment-term.schema';

@Injectable()
export class PaymentTermMongoRepository implements PaymentTermRepository {
  constructor(
    @InjectModel(PaymentTerm.name)
    private readonly model: Model<PaymentTerm>,
  ) {}

  async upsertMany(
    company: string,
    paymentTerms: ICreatePaymentTerm[],
  ): Promise<void> {
    const ops = paymentTerms.map((pt) => ({
      updateOne: {
        filter: { company, name: pt.name },
        update: { $set: { ...pt, company } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
  }

  async getList(
    filter: IPaymentTermListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IPaymentTerm[]> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.name) {
      q['name'] = {
        $regex: new RegExp(filter.name, 'i'),
      };
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
      name: doc.name,
      description: doc.description,
      numberOfMonths: doc.numberOfMonths,
      cutoffDayOfMonth: doc.cutoffDayOfMonth,
      creditCardCreditCheckType: doc.creditCardCreditCheckType,
      paymentScheduleName: doc.paymentScheduleName,
      isDefaultPaymentTerm: doc.isDefaultPaymentTerm,
      creditCardPaymentType: doc.creditCardPaymentType,
      isCashPayment: doc.isCashPayment,
      numberOfDays: doc.numberOfDays,
      customerDueDateUpdatePolicy: doc.customerDueDateUpdatePolicy,
      paymentDayName: doc.paymentDayName,
      vendorDueDateUpdatePolicy: doc.vendorDueDateUpdatePolicy,
      postOffsettingAR: doc.postOffsettingAR,
      paymentMethodType: doc.paymentMethodType,
      cashPaymentMainAccountIdDisplayValue:
        doc.cashPaymentMainAccountIdDisplayValue,
      isCertifiedCompanyCheck: doc.isCertifiedCompanyCheck,
      additionalMonthsForCutoffDate: doc.additionalMonthsForCutoffDate,
    }));
  }

  async getCount(filter: IPaymentTermListFilter): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter.company) q['company'] = filter.company;
    if (filter.name) {
      q['name'] = {
        $regex: new RegExp(filter.name, 'i'),
      };
    }
    return this.model.countDocuments(q).exec();
  }
}
