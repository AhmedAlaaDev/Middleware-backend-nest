import { EntryVoucherType, EntrySafeType } from '@/modules/cash/types';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

export class CashEntryRawDataModel extends EntryRawDataModel {
  // custom columns you have in the JSON
  SafeTransaction: 'In' | 'Out';
  SafeType: EntrySafeType;
  VoucherType: EntryVoucherType;

  // ACCOUNT TYPE FLAGS
  IsCustomer: boolean;
  IsPettyCash: boolean;
  IsLedger: boolean;
  IsVendor: boolean;
  IsBank: boolean;

  // VOUCHER TYPE FLAGS
  IsCash: boolean;
  IsCheque: boolean;
  IsDeposit: boolean;
  IsPOS: boolean;
  IsPrePayment: boolean;
  IsTransfer: boolean;
  IsVisa: boolean;

  // SAFETY TYPE FLAGS
  IsCustodySettlement: boolean;
  IsCustomerCollection: boolean;
  IsDownPayment: boolean;
  IsCN: boolean;
  IsCustodyIssue: boolean;
  IsDirect: boolean;
  IsOther: boolean;
  IsVendorPayment: boolean;
  IsCustodyVendor: boolean;
  VendorGroup: string;

  constructor(
    data: EntryRawDataModel,
    type: 'Freight' | 'Fleet',
    isInbound = true,
  ) {
    super(data);
    const s = (v: unknown) => this.lookupResultAsString(v);

    const PAYMENTREFERENCE = this.generatePaymentReference(data, type);
    this.PAYMENTREFERENCE = PAYMENTREFERENCE;

    this.SafeTransaction = isInbound ? 'In' : 'Out';
    this.SafeType = this.normalizeSafeType(data?.SafeType, !isInbound);
    this.VoucherType = s(data?.VoucherType) as EntryVoucherType;

    this.IsCustomer = this.compare(data?.ACCOUNTTYPE, 'cust');
    this.IsPettyCash =
      this.compare(data?.ACCOUNTTYPE, 'petty cash') ||
      this.compare(data?.ACCOUNTTYPE, 'rcash');
    this.IsLedger = this.compare(data?.ACCOUNTTYPE, 'ledger');
    this.IsVendor = this.compare(data?.ACCOUNTTYPE, 'vend');
    this.IsBank = this.compare(data?.ACCOUNTTYPE, 'bank');

    this.IsCash = this.compare(data?.VoucherType, 'cash');
    this.IsCheque = this.compare(data?.VoucherType, 'cheque');
    this.IsDeposit = this.compare(data?.VoucherType, 'deposit');
    this.IsPOS = this.compare(data?.VoucherType, 'pos');
    this.IsPrePayment = this.compare(data?.PREPAYMENT, 'prepayment');
    this.IsTransfer = this.compare(data?.VoucherType, 'transfer');
    this.IsVisa = this.compare(data?.VoucherType, 'visa');

    this.IsCustodySettlement = this.compare(
      this.SafeType,
      'Custody Settlement',
    );
    this.IsCustomerCollection = this.compare(
      this.SafeType,
      'Customer Collection',
    );
    this.IsDownPayment = this.compare(this.SafeType, 'DownPayment');
    this.IsCN = this.compare(this.SafeType, 'CN');
    this.IsCustodyIssue = this.compare(this.SafeType, 'Custody Issue');
    this.IsDirect = this.compare(this.SafeType, 'Direct');
    this.IsOther = this.compare(this.SafeType, 'Other');
    this.IsVendorPayment = this.compare(this.SafeType, 'Vendor Payment');
    this.IsCustodyVendor = false;
    this.VendorGroup = s((data as any)?.VendorGroup);
  }

  private normalizeSafeType(
    value: unknown,
    defaultEmpty: boolean,
  ): EntrySafeType {
    const raw = this.lookupResultAsString(value).trim();
    const token = raw.toLowerCase().replace(/[\s_-]+/g, '');

    const normalized: Record<string, EntrySafeType> = {
      vendorpayment: 'Vendor Payment',
      custodysettlement: 'Custody Settlement',
      custodyissue: 'Custody Issue',
      customercollection: 'Customer Collection',
      downpayment: 'DownPayment',
      cn: 'CN',
      direct: 'Direct',
      other: 'Other',
    };

    if (!token && defaultEmpty) return 'Custody Settlement';
    return normalized[token] ?? (raw as EntrySafeType);
  }

  private generatePaymentReference(
    data: EntryRawDataModel,
    type: 'Freight' | 'Fleet',
  ): string {
    const paymentReference = this.lookupResultAsString(data?.PAYMENTREFERENCE);
    const description = this.lookupResultAsString(data?.DESCRIPTION);

    const ignoredPaymentReferences = [
      '0',
      '00',
      '000',
      'N/A',
      '000000000',
      '0000000000',
      '00000000000',
    ];

    if (
      paymentReference &&
      !ignoredPaymentReferences.includes(paymentReference)
    ) {
      return paymentReference;
    }

    return `${description || ''} - ${type}`;
  }
}
