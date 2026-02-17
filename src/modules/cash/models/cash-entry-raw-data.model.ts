import { EntryVoucherType, EntrySafeType } from '@/modules/cash/types';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

export class CashEntryRawDataModel extends EntryRawDataModel {
  PREPAYMENT: 'Yes' | 'No';
  SALESTAXGROUP: string;
  ITEMSALESTAXGROUP: string;

  ISWITHHOLDINGCALCULATIONENABLED: 'Yes' | 'No';
  ITEMWITHHOLDINGTAXGROUPCODE: string;

  DOCUMENTDATE: string;
  DUEDATE: string;

  PAYMENTMETHOD: string;
  PAYMENTREFERENCE: string;

  CASHDISCOUNT: number;
  CASHDISCOUNTAMOUNT: number;
  CASHDISCOUNTDATE: string;

  OVERRIDESALESTAX: string;

  PAYMENTID: string;
  QUANTITY: number;

  REVERSEDATE: string;
  REVERSEENTRY: 'Yes' | 'No';

  // custom columns you have in the JSON
  SafeTransaction: 'In';
  SafeType: EntrySafeType;
  VoucherType: EntryVoucherType;

  IsCredit: boolean;
  IsDebit: boolean;

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
  IsCustodyIssue: boolean;
  IsDirect: boolean;
  IsOther: boolean;
  IsVendorPayment: boolean;

  constructor(data: EntryRawDataModel, type: 'Freight' | 'Fleet') {
    super(data);
    const s = (v: unknown) => this.lookupResultAsString(v);
    const n = (v: unknown) => this.lookupResultAsNumber(v);

    const PAYMENTREFERENCE = this.generatePaymentReference(data, type);

    this.PREPAYMENT = (s(data?.PREPAYMENT) as 'Yes' | 'No') || 'No';
    this.SALESTAXGROUP = s(data?.SALESTAXGROUP);
    this.ITEMSALESTAXGROUP = s(data?.ITEMSALESTAXGROUP);
    this.ISWITHHOLDINGCALCULATIONENABLED =
      (s(data?.ISWITHHOLDINGCALCULATIONENABLED) as 'Yes' | 'No') || 'No';
    this.ITEMWITHHOLDINGTAXGROUPCODE = s(data?.ITEMWITHHOLDINGTAXGROUPCODE);
    this.DOCUMENTDATE = s(data?.DOCUMENTDATE);
    this.DUEDATE = s(data?.DUEDATE);
    this.PAYMENTMETHOD = s(data?.PAYMENTMETHOD);
    this.PAYMENTREFERENCE = PAYMENTREFERENCE;
    this.CASHDISCOUNT = Number(n(data?.CASHDISCOUNT)) || 0;
    this.CASHDISCOUNTAMOUNT = Number(n(data?.CASHDISCOUNTAMOUNT)) || 0;
    this.CASHDISCOUNTDATE = s(data?.CASHDISCOUNTDATE);
    this.OVERRIDESALESTAX = s(data?.OVERRIDESALESTAX);
    this.PAYMENTID = s(data?.PAYMENTID);
    this.QUANTITY = Number(n(data?.QUANTITY)) || 0;
    this.REVERSEDATE = s(data?.REVERSEDATE);
    this.REVERSEENTRY = (s(data?.REVERSEENTRY) as 'Yes' | 'No') || 'No';
    this.SafeTransaction = 'In';
    this.SafeType = s(data?.SafeType) as EntrySafeType;
    this.VoucherType = s(data?.VoucherType) as EntryVoucherType;
    this.IsCredit = this.CREDITAMOUNT > 0;
    this.IsDebit = this.DEBITAMOUNT > 0;

    this.IsCustomer = this.compare(data?.ACCOUNTTYPE, 'cust');
    this.IsPettyCash = this.compare(data?.ACCOUNTTYPE, 'petty cash');
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
      data?.SafeType,
      'Custody Settlement',
    );
    this.IsCustomerCollection = this.compare(
      data?.SafeType,
      'Customer Collection',
    );
    this.IsDownPayment = this.compare(data?.SafeType, 'DownPayment');
    this.IsCustodyIssue = this.compare(data?.SafeType, 'Custody Issue');
    this.IsDirect = this.compare(data?.SafeType, 'Direct');
    this.IsOther = this.compare(data?.SafeType, 'Other');
    this.IsVendorPayment = this.compare(data?.SafeType, 'Vendor Payment');
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
