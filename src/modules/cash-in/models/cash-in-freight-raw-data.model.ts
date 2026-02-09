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

  ACCOUNTTYPE: string;
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
  PAYMENTREFERENCE?: string;

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
  SafeType?: string;
  VoucherType?: string;

  // handy flags (optional)
  ISCUSTOMER: boolean;
  ISPETTYCASH: boolean;
  ISLEDGER: boolean;
  ISVENDOR: boolean;
  ISBANK: boolean;

  ISCASH: boolean;
  ISCHEQUE: boolean;
  ISDEPOSIT: boolean;
  ISPOS: boolean;
  ISPREPAYMENT: boolean;

  constructor(data: RawDataModel) {
    const s = (v: unknown) => this.lookupResultAsString(v);
    const n = (v: unknown) => this.lookupResultAsNumber(v);

    Object.assign(this, {
      ...data,

      // --- IDs and line ---
      UniqueId: Number(n(data?.UniqueId)) || 0,
      LINENUMBER: Number(n(data?.LINENUMBER)) || 0,

      // --- String fields (unwrap lookup cells from Excel) ---
      JOURNALBATCHNUMBER: s(data?.JOURNALBATCHNUMBER),
      JOURNALNAME: s(data?.JOURNALNAME),
      DESCRIPTION: s(data?.DESCRIPTION),
      VOUCHER: s(data?.VOUCHER),
      TRANSDATE: s(data?.TRANSDATE),
      ACCOUNTTYPE: s(data?.ACCOUNTTYPE),
      ACCOUNTDISPLAYVALUE: s(data?.ACCOUNTDISPLAYVALUE),
      DEFAULTDIMENSIONDISPLAYVALUE: s(data?.DEFAULTDIMENSIONDISPLAYVALUE),
      FINTAGDISPLAYVALUE: s(data?.FINTAGDISPLAYVALUE),
      TEXT: s(data?.TEXT),

      // --- Amounts and rates (numbers) ---
      DEBITAMOUNT: Number(n(data?.DEBITAMOUNT)) || 0,
      CREDITAMOUNT: Number(n(data?.CREDITAMOUNT)) || 0,
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
      PAYMENTREFERENCE: s(data?.PAYMENTREFERENCE),

      // --- Derived flags from ACCOUNTTYPE ---
      ISCUSTOMER: this.isAccountType(data?.ACCOUNTTYPE, 'cust'),
      ISPETTYCASH: this.isAccountType(data?.ACCOUNTTYPE, 'petty cash'),
      ISLEDGER: this.isAccountType(data?.ACCOUNTTYPE, 'ledger'),
      ISVENDOR: this.isAccountType(data?.ACCOUNTTYPE, 'vend'),
      ISBANK: this.isAccountType(data?.ACCOUNTTYPE, 'bank'),

      // --- Derived flags from VoucherType ---
      ISCASH: this.isAccountType(data?.VoucherType, 'cash'),
      ISCHEQUE: this.isAccountType(data?.VoucherType, 'cheque'),
      ISDEPOSIT: this.isAccountType(data?.VoucherType, 'deposit'),
      ISPOS: this.isAccountType(data?.VoucherType, 'pos'),
      ISPREPAYMENT:
        this.toBoolean(data?.PREPAYMENT) ||
        this.isAccountType(data?.POSTINGPROFILE, 'prepayment'),
    });
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

  private isAccountType(value: any, equalsTo: string): boolean {
    return this.lowerTrimed(String(value ?? '')) === this.lowerTrimed(equalsTo);
  }

  private lowerTrimed(value: string): string {
    return value?.toLowerCase()?.trim();
  }
}
