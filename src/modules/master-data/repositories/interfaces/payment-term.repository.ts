import {
  ICreatePaymentTerm,
  IPaymentTerm,
  IPaymentTermListFilter,
} from '@/modules/master-data/interfaces/payment-term.interface';

export abstract class PaymentTermRepository {
  abstract upsertMany(
    company: string,
    paymentTerms: ICreatePaymentTerm[],
  ): Promise<void>;
  abstract getList(
    filter: IPaymentTermListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IPaymentTerm[]>;
  abstract getCount(filter: IPaymentTermListFilter): Promise<number>;
}
