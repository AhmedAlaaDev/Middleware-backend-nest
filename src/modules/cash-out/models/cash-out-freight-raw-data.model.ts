import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

type LookupCell<T = any> = { formula?: string; result?: T } | T;

export class CashOutFreightRawData {
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
  TAXEXEMPTNUMBER?: string;

  ISWITHHOLDINGCALCULATIONENABLED: boolean;

  DOCUMENT?: string;
  DOCUMENTDATE?: string;
  DUEDATE?: string;
  INVOICE?: string;
  PAYMENTMETHOD?: string;

  CASHDISCOUNT: number;
  CASHDISCOUNTAMOUNT: number;
  CASHDISCOUNTDATE?: string;

  EXCHANGERATESECONDARY: number;
  OVERRIDESALESTAX?: string;

  PAYMENTID?: string;
  PAYMENTREFERENCE?: string;
  QUANTITY: number;

  REPORTINGCURRENCYEXCHRATESECONDARY: number;
  REPORTINGCURRENCYEXCHRATE?: string;

  REVERSEDATE?: string;
  REVERSEENTRY: boolean;

  SALESTAXCODE?: string;
  POSTINGPROFILE?: string;
  POSTINGLAYER?: string;

  ISPOSTED: boolean;

  // custom columns
  SafeTransaction?: string;
  SafeType?: string;
  VoucherType?: string;

  // handy flags
  ISVENDOR: boolean;
  ISPETTYCASH: boolean;
  ISLEDGER: boolean;

  constructor(data: RawDataModel) {
    Object.assign(this, {
      ...data,

      // lookup cells -> their result
      JOURNALBATCHNUMBER: this.lookupResultAsString(data?.JOURNALBATCHNUMBER),
      TEXT: this.lookupResultAsString(data?.TEXT),
      CREDITAMOUNT: this.lookupResultAsNumber(data?.CREDITAMOUNT),
      DEBITAMOUNT: this.lookupResultAsNumber(data?.DEBITAMOUNT),

      // normalize common types
      LINENUMBER: Number(data?.LINENUMBER),

      EXCHANGERATE: Number(data?.EXCHANGERATE ?? 0),
      EXCHANGERATESECONDARY: Number(data?.EXCHANGERATESECONDARY ?? 0),

      CASHDISCOUNT: Number(data?.CASHDISCOUNT ?? 0),
      CASHDISCOUNTAMOUNT: Number(data?.CASHDISCOUNTAMOUNT ?? 0),

      QUANTITY: Number(data?.QUANTITY ?? 0),
      REPORTINGCURRENCYEXCHRATESECONDARY: Number(
        data?.REPORTINGCURRENCYEXCHRATESECONDARY ?? 0,
      ),

      // yes/no fields -> boolean
      ISPOSTED: this.toBoolean(data?.ISPOSTED),
      ISWITHHOLDINGCALCULATIONENABLED: this.toBoolean(
        data?.ISWITHHOLDINGCALCULATIONENABLED,
      ),
      REVERSEENTRY: this.toBoolean(data?.REVERSEENTRY),

      // quick flags based on ACCOUNTTYPE
      ISVENDOR: this.isAccountType(data?.ACCOUNTTYPE, 'vend'),
      ISPETTYCASH: this.isAccountType(data?.ACCOUNTTYPE, 'petty cash'),
      ISLEDGER: this.isAccountType(data?.ACCOUNTTYPE, 'ledger'),
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
