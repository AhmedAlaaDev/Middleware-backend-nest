import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

type LookupCell<T = any> = { formula?: string; result?: T } | T;

export class CashInFreightRawData {
  UniqueId: number;
  LINENUMBER: number;

  JOURNALBATCHNUMBER: string;
  JOURNALNAME: string;
  DESCRIPTION?: string;

  VOUCHER: string;
  TRANSDATE: string;

  ACCOUNTTYPE: 'Cust' | 'Ledger' | 'Vend' | 'Bank' | 'Petty cash';
  ACCOUNTDISPLAYVALUE: string;

  DEFAULTDIMENSIONDISPLAYVALUE?: string;
  FINTAGDISPLAYVALUE?: string;

  TEXT?: string;

  DEBITAMOUNT: number;
  CREDITAMOUNT: number;

  CURRENCYCODE?: string;
  EXCHANGERATE: number;

  OFFSETACCOUNTTYPE?: string;
  OFFSETACCOUNTDISPLAYVALUE?: string;
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE?: string;
  OFFSETFINTAGDISPLAYVALUE?: string;
  OFFSETTEXT?: string;

  PREPAYMENT?: string;
  SALESTAXGROUP?: string;
  ITEMSALESTAXGROUP?: string;
  TAXEXEMPTNUMBER?: string;

  ISWITHHOLDINGCALCULATIONENABLED: boolean;
  ITEMWITHHOLDINGTAXGROUPCODE?: string;

  DOCUMENT?: string;
  DOCUMENTDATE?: string;
  DUEDATE?: string;
  INVOICE?: string;
  PAYMENTMETHOD?: string;
  PAYMENTREFERENCE: string;

  CASHDISCOUNT: number;
  CASHDISCOUNTAMOUNT: number;
  CASHDISCOUNTDATE?: string;

  EXCHANGERATESECONDARY: number;
  OVERRIDESALESTAX?: string;

  PAYMENTID?: string;
  QUANTITY: number;

  REPORTINGCURRENCYEXCHRATESECONDARY: number;
  REPORTINGCURRENCYEXCHRATE?: string;

  REVERSEDATE?: string;
  REVERSEENTRY: boolean;

  SALESTAXCODE?: string;
  POSTINGPROFILE?: string;
  POSTINGLAYER?: string;

  ISPOSTED: boolean;

  // custom columns you have in the JSON
  SafeTransaction?: string;
  SafeType:
    | 'Customer Collection'
    | 'Custody Settlement'
    | 'DownPayment'
    | 'Custody Issue'
    | 'Direct'
    | 'Other'
    | 'Vendor Payment';

  VoucherType:
    | 'Cash'
    | 'Cheque'
    | 'Deposit'
    | 'POS'
    | 'PrePayment'
    | 'Transfer'
    | 'Visa';

  ISDEBIT: boolean;
  ISCREDIT: boolean;

  // ACCOUNT TYPE FLAGS
  ISCUSTOMER: boolean;
  ISPETTYCASH: boolean;
  ISLEDGER: boolean;
  ISVENDOR: boolean;
  ISBANK: boolean;

  // VOUCHER TYPE FLAGS
  ISCASH: boolean;
  ISCHEQUE: boolean;
  ISDEPOSIT: boolean;
  ISPOS: boolean;
  ISPREPAYMENT: boolean;
  ISTRANSFER: boolean;
  ISVISA: boolean;

  // SAFETY TYPE FLAGS
  ISCUSTODYSETTLEMENT: boolean;
  ISCUSTOMERCOLLECTION: boolean;
  ISDOWNPAYMENT: boolean;
  ISCUSTODYISSUE: boolean;
  ISDIRECT: boolean;
  ISOTHER: boolean;
  ISVENDORPAYMENT: boolean;

  constructor(data: RawDataModel) {
    const s = (v: unknown) => this.lookupResultAsString(v);
    const n = (v: unknown) => this.lookupResultAsNumber(v);

    const PAYMENTREFERENCE = this.generatePaymentReference(data);
    const DEBITAMOUNT = Number(n(data?.DEBITAMOUNT)) || 0;
    const CREDITAMOUNT = Number(n(data?.CREDITAMOUNT)) || 0;

    Object.assign(this, {
      ...data,

      // --- IDs and line ---
      UniqueId: Number(n(data?.UniqueId)) || 0,
      LINENUMBER: Number(n(data?.LINENUMBER)) || 0,

      // --- String fields (unwrap lookup cells from Excel) ---
      JOURNALBATCHNUMBER: s(data?.JOURNALBATCHNUMBER),
      JOURNALNAME: s(data?.JOURNALNAME),
      DESCRIPTION: PAYMENTREFERENCE,
      VOUCHER: s(data?.VOUCHER),
      TRANSDATE: s(data?.TRANSDATE),
      ACCOUNTTYPE: s(data?.ACCOUNTTYPE),
      ACCOUNTDISPLAYVALUE: s(data?.ACCOUNTDISPLAYVALUE),
      DEFAULTDIMENSIONDISPLAYVALUE: s(data?.DEFAULTDIMENSIONDISPLAYVALUE),
      FINTAGDISPLAYVALUE: s(data?.FINTAGDISPLAYVALUE),
      TEXT: s(data?.TEXT),

      // --- Amounts and rates (numbers) ---
      DEBITAMOUNT,
      CREDITAMOUNT,
      CURRENCYCODE: s(data?.CURRENCYCODE),
      EXCHANGERATE: Number(n(data?.EXCHANGERATE)) || 0,

      // --- Offset fields ---
      OFFSETACCOUNTDISPLAYVALUE: s(data?.OFFSETACCOUNTDISPLAYVALUE),
      OFFSETDEFAULTDIMENSIONDISPLAYVALUE: s(
        data?.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
      ),
      OFFSETFINTAGDISPLAYVALUE: s(data?.OFFSETFINTAGDISPLAYVALUE),
      OFFSETTEXT: s(data?.OFFSETTEXT),

      // --- Tax and payment ---
      PREPAYMENT: s(data?.PREPAYMENT),
      SALESTAXGROUP: s(data?.SALESTAXGROUP),
      TAXEXEMPTNUMBER: s(data?.TAXEXEMPTNUMBER),
      ISWITHHOLDINGCALCULATIONENABLED: this.toBoolean(
        data?.ISWITHHOLDINGCALCULATIONENABLED,
      ),
      DOCUMENT: s(data?.DOCUMENT),
      INVOICE: s(data?.INVOICE),
      PAYMENTMETHOD: s(data?.PAYMENTMETHOD),
      CASHDISCOUNT: Number(n(data?.CASHDISCOUNT)) || 0,
      CASHDISCOUNTAMOUNT: Number(n(data?.CASHDISCOUNTAMOUNT)) || 0,
      CASHDISCOUNTDATE: s(data?.CASHDISCOUNTDATE),
      EXCHANGERATESECONDARY: Number(n(data?.EXCHANGERATESECONDARY)) || 0,
      OVERRIDESALESTAX: s(data?.OVERRIDESALESTAX),
      PAYMENTID: s(data?.PAYMENTID),
      QUANTITY: Number(n(data?.QUANTITY)) || 0,
      REPORTINGCURRENCYEXCHRATESECONDARY:
        Number(n(data?.REPORTINGCURRENCYEXCHRATESECONDARY)) || 0,
      REPORTINGCURRENCYEXCHRATE: s(data?.REPORTINGCURRENCYEXCHRATE),
      REVERSEDATE: s(data?.REVERSEDATE),
      REVERSEENTRY: this.toBoolean(data?.REVERSEENTRY),
      SALESTAXCODE: s(data?.SALESTAXCODE),
      POSTINGPROFILE: s(data?.POSTINGPROFILE),
      POSTINGLAYER: s(data?.POSTINGLAYER),
      ISPOSTED: this.toBoolean(data?.ISPOSTED),

      // --- Custom columns from Excel ---
      SafeTransaction: s(data?.SafeTransaction),
      SafeType: s(data?.SafeType),
      VoucherType: s(data?.VoucherType),

      // --- Optional fields (may exist in other templates) ---
      OFFSETACCOUNTTYPE: s(data?.OFFSETACCOUNTTYPE),
      ITEMSALESTAXGROUP: s(data?.ITEMSALESTAXGROUP),
      ITEMWITHHOLDINGTAXGROUPCODE: s(data?.ITEMWITHHOLDINGTAXGROUPCODE),
      DOCUMENTDATE: s(data?.DOCUMENTDATE),
      DUEDATE: s(data?.DUEDATE),
      PAYMENTREFERENCE,

      ISDEBIT: DEBITAMOUNT > 0,
      ISCREDIT: CREDITAMOUNT > 0,

      // --- Derived flags from ACCOUNTTYPE ---
      ISCUSTOMER: this.compare(data?.ACCOUNTTYPE, 'cust'),
      ISPETTYCASH: this.compare(data?.ACCOUNTTYPE, 'petty cash'),
      ISLEDGER: this.compare(data?.ACCOUNTTYPE, 'ledger'),
      ISVENDOR: this.compare(data?.ACCOUNTTYPE, 'vend'),
      ISBANK: this.compare(data?.ACCOUNTTYPE, 'bank'),

      // --- Derived flags from VoucherType ---
      ISCASH: this.compare(data?.VoucherType, 'cash'),
      ISCHEQUE: this.compare(data?.VoucherType, 'cheque'),
      ISDEPOSIT: this.compare(data?.VoucherType, 'deposit'),
      ISPOS: this.compare(data?.VoucherType, 'pos'),
      ISPREPAYMENT:
        this.toBoolean(data?.PREPAYMENT) ||
        this.compare(data?.POSTINGPROFILE, 'prepayment'),
      ISTRANSFER: this.compare(data?.VoucherType, 'transfer'),
      ISVISA: this.compare(data?.VoucherType, 'visa'),

      // --- Derived flags from SafeType ---
      ISCUSTODYSETTLEMENT: this.compare(data?.SafeType, 'Custody Settlement'),
      ISCUSTOMERCOLLECTION: this.compare(data?.SafeType, 'Customer Collection'),
      ISDOWNPAYMENT: this.compare(data?.SafeType, 'DownPayment'),
      ISCUSTODYISSUE: this.compare(data?.SafeType, 'Custody Issue'),
      ISDIRECT: this.compare(data?.SafeType, 'Direct'),
      ISOTHER: this.compare(data?.SafeType, 'Other'),
      ISVENDORPAYMENT: this.compare(data?.SafeType, 'Vendor Payment'),
    });
  }

  private generatePaymentReference(data: RawDataModel): string {
    const paymentReference = this.lookupResultAsString(data?.PAYMENTREFERENCE);
    const description = this.lookupResultAsString(data?.DESCRIPTION);
    const journalName = this.lookupResultAsString(data?.JOURNALNAME);

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
    )
      return paymentReference;

    return `${description || ''} - ${journalName || ''}`;
  }

  private lookupResult<T = any>(value: LookupCell<T>): T {
    if (value && typeof value === 'object' && 'result' in value) {
      return (value as any).result;
    }
    return value as T;
  }

  private lookupResultAsString(value: LookupCell<any>): string {
    const v = this.lookupResult<any>(value);
    if (v == null) return '';
    if (typeof v === 'object') return ''; // e.g. { error: "#N/A" }
    return String(v);
  }

  private lookupResultAsNumber(value: LookupCell<any>): number {
    const v = this.lookupResult<any>(value);
    if (v == null) return 0;
    if (typeof v === 'object') return 0; // e.g. { error: "#N/A" }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private toBoolean(value: any): boolean {
    const v = this.lowerTrimed(String(value ?? ''));
    return v === 'yes' || v === 'true' || v === '1';
  }

  private compare(value: any, equalsTo: string): boolean {
    return this.lowerTrimed(String(value ?? '')) === this.lowerTrimed(equalsTo);
  }

  private lowerTrimed(value: string): string {
    return value?.toLowerCase()?.trim();
  }
}
