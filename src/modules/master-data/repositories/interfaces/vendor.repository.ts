import {
  ICreateVendor,
  IVendor,
  IVendorListFilter,
} from '@/modules/master-data/interfaces/vendor.interface';

export abstract class VendorRepository {
  abstract upsertMany(company: string, vendors: ICreateVendor[]): Promise<void>;
  abstract getList(
    filter: IVendorListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IVendor[]>;
  abstract getCount(filter: IVendorListFilter): Promise<number>;
  abstract findByAccount(
    company: string,
    vendorAccountNumber: string,
  ): Promise<IVendor | null>;
  abstract deleteByCompany(company: string): Promise<void>;
}
