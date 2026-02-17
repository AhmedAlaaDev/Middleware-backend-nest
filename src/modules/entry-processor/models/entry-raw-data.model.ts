import { EntryAccountType, LookupCell } from '@/common/types';

/**
 * Source (raw) row from import (e.g. Excel/CSV).
 * Shared properties across cash-in, cash-out, vendor, account-receivable,
 * ledger-closing, and custody-settlement raw models.
 * Naming: UPPERCASE for source fields; UniqueId remains PascalCase.
 */
export class EntryRawDataModel {
  /** Unique row id, used to build DynDataModel.SourceIds */
  UniqueId: number;
  /** Line number (source column LINENUMBER) */
  LINENUMBER: number;
  /** Batch number (source column JOURNALBATCHNUMBER) */
  JOURNALBATCHNUMBER: string;
  /** Voucher (source column VOUCHER) */
  VOUCHER: string;
  /** Transaction date */
  TRANSDATE: string;
  /** Journal name */
  JOURNALNAME: string;
  /** Description */
  DESCRIPTION: string;
  /** Account type (e.g. Ledger, Vend, Cust) */
  ACCOUNTTYPE: EntryAccountType;
  /** Main account display value */
  ACCOUNTDISPLAYVALUE: string;
  /** Default dimension display value */
  DEFAULTDIMENSIONDISPLAYVALUE: string;
  /** Fin tag display value */
  FINTAGDISPLAYVALUE: string;
  /** Line text */
  TEXT: string;
  /** Debit amount */
  DEBITAMOUNT: number;
  /** Credit amount */
  CREDITAMOUNT: number;
  /** Currency code */
  CURRENCYCODE: string;
  /** Exchange rate */
  EXCHANGERATE: number;
  /** Exchange rate secondary */
  EXCHANGERATESECONDARY: number;
  /** Reporting currency exchange rate */
  REPORTINGCURRENCYEXCHRATE: number;
  /** Reporting currency exchange rate secondary */
  REPORTINGCURRENCYEXCHRATESECONDARY: number;
  /** Document */
  DOCUMENT: string;
  /** Invoice */
  INVOICE: string;
  /** Posting profile */
  POSTINGPROFILE: string;
  /** Posting layer */
  POSTINGLAYER: string;
  /** Tax exempt number */
  TAXEXEMPTNUMBER: number;
  /** Sales tax code */
  SALESTAXCODE: string;
  /** Is posted */
  ISPOSTED: 'Yes' | 'No';
  /** Prepayment */
  PREPAYMENT: 'Yes' | 'No';
  /** Sales tax group */
  SALESTAXGROUP: string;
  /** Item sales tax group */
  ITEMSALESTAXGROUP: string;
  /** Item with holding tax group code */
  ISWITHHOLDINGCALCULATIONENABLED: 'Yes' | 'No';
  /** Item with holding tax group code */
  ITEMWITHHOLDINGTAXGROUPCODE: string;
  /** Override sales tax */
  OVERRIDESALESTAX: string;
  /** Document date */
  DOCUMENTDATE: string;
  /** Due date */
  DUEDATE: string;
  /** Payment method */
  PAYMENTMETHOD: string;
  /** Payment reference */
  PAYMENTREFERENCE: string;
  /** Cash discount */
  CASHDISCOUNT: number;
  /** Cash discount amount */
  CASHDISCOUNTAMOUNT: number;
  /** Cash discount date */
  CASHDISCOUNTDATE: string;
  /** Payment id */
  PAYMENTID: string;
  /** Quantity */
  QUANTITY: number;
  /** Reverse date */
  REVERSEDATE: string;
  /** Reverse entry */
  REVERSEENTRY: 'Yes' | 'No';

  /** Is credit */
  IsCredit: boolean;
  /** Is debit */
  IsDebit: boolean;

  /** Other fields from the source data */
  [key: string]: any;

  constructor(data: Partial<EntryRawDataModel>) {
    const s = (v: unknown) => this.lookupResultAsString(v);
    const n = (v: unknown) => this.lookupResultAsNumber(v);

    this.UniqueId = n(data.UniqueId);
    this.LINENUMBER = n(data.LINENUMBER);
    this.JOURNALBATCHNUMBER = s(data.JOURNALBATCHNUMBER);
    this.VOUCHER = s(data.VOUCHER);
    this.TRANSDATE = s(data.TRANSDATE);
    this.JOURNALNAME = s(data.JOURNALNAME);
    this.DESCRIPTION = s(data.DESCRIPTION);
    this.ACCOUNTTYPE = s(data.ACCOUNTTYPE) as EntryAccountType;
    this.ACCOUNTDISPLAYVALUE = s(data.ACCOUNTDISPLAYVALUE);
    this.DEFAULTDIMENSIONDISPLAYVALUE = s(data.DEFAULTDIMENSIONDISPLAYVALUE);
    this.FINTAGDISPLAYVALUE = s(data.FINTAGDISPLAYVALUE);
    this.TEXT = s(data.TEXT);
    this.DEBITAMOUNT = n(data.DEBITAMOUNT);
    this.CREDITAMOUNT = n(data.CREDITAMOUNT);
    this.CURRENCYCODE = s(data.CURRENCYCODE);
    this.EXCHANGERATE = n(data.EXCHANGERATE);
    this.EXCHANGERATESECONDARY = n(data.EXCHANGERATESECONDARY);
    this.REPORTINGCURRENCYEXCHRATE = n(data.REPORTINGCURRENCYEXCHRATE);
    this.REPORTINGCURRENCYEXCHRATESECONDARY = n(
      data.REPORTINGCURRENCYEXCHRATESECONDARY,
    );
    this.DOCUMENT = s(data.DOCUMENT);
    this.INVOICE = s(data.INVOICE);
    this.POSTINGPROFILE = s(data.POSTINGPROFILE);
    this.POSTINGLAYER = s(data.POSTINGLAYER);
    this.TAXEXEMPTNUMBER = n(data.TAXEXEMPTNUMBER);
    this.SALESTAXCODE = s(data.SALESTAXCODE);
    this.ISPOSTED = data.ISPOSTED || 'No';
    this.PREPAYMENT = (s(data?.PREPAYMENT) as 'Yes' | 'No') || 'No';
    this.SALESTAXGROUP = s(data?.SALESTAXGROUP);
    this.ITEMSALESTAXGROUP = s(data?.ITEMSALESTAXGROUP);
    this.ISWITHHOLDINGCALCULATIONENABLED =
      (s(data?.ISWITHHOLDINGCALCULATIONENABLED) as 'Yes' | 'No') || 'No';
    this.ITEMWITHHOLDINGTAXGROUPCODE = s(data?.ITEMWITHHOLDINGTAXGROUPCODE);
    this.DOCUMENTDATE = s(data?.DOCUMENTDATE);
    this.DUEDATE = s(data?.DUEDATE);
    this.PAYMENTMETHOD = s(data?.PAYMENTMETHOD);
    this.PAYMENTREFERENCE = s(data?.PAYMENTREFERENCE);
    this.CASHDISCOUNT = Number(n(data?.CASHDISCOUNT)) || 0;
    this.CASHDISCOUNTAMOUNT = Number(n(data?.CASHDISCOUNTAMOUNT)) || 0;
    this.CASHDISCOUNTDATE = s(data?.CASHDISCOUNTDATE);
    this.OVERRIDESALESTAX = s(data?.OVERRIDESALESTAX);
    this.PAYMENTID = s(data?.PAYMENTID);
    this.QUANTITY = Number(n(data?.QUANTITY)) || 0;
    this.REVERSEDATE = s(data?.REVERSEDATE);
    this.REVERSEENTRY = (s(data?.REVERSEENTRY) as 'Yes' | 'No') || 'No';

    this.IsCredit = n(this.CREDITAMOUNT) > 0;
    this.IsDebit = n(this.DEBITAMOUNT) > 0;
  }

  protected lookupResult<T = any>(value: LookupCell<T>): T {
    if (value && typeof value === 'object' && 'result' in value) {
      return (value as any).result;
    }
    return value as T;
  }

  protected lookupResultAsString(value: LookupCell<any>): string {
    const v = this.lookupResult<any>(value);
    if (v == null) return '';
    if (typeof v === 'object') return ''; // e.g. { error: "#N/A" }
    return String(v);
  }

  protected lookupResultAsNumber(value: LookupCell<any>): number {
    const v = this.lookupResult<any>(value);
    if (v == null) return 0;
    if (typeof v === 'object') return 0; // e.g. { error: "#N/A" }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  protected toBoolean(value: any): boolean {
    const v = this.lowerTrimed(String(value ?? ''));
    return v === 'yes' || v === 'true' || v === '1';
  }

  protected compare(value: any, equalsTo: string): boolean {
    return this.lowerTrimed(String(value ?? '')) === this.lowerTrimed(equalsTo);
  }

  protected lowerTrimed(value: string): string {
    return value?.toLowerCase()?.trim();
  }
}
