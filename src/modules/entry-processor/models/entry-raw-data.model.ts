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
  /** Marked Invoice */
  MARKEDINVOICE: string;
  /** Invoice Amount */
  INVOICEAMOUNT: number;
  /** Original Invoice Amount */
  ORIGINALINVOICEAMOUNT: number;
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
    this.TRANSDATE = this.normalizeDate(data.TRANSDATE);
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
    this.MARKEDINVOICE = s(data.MARKEDINVOICE);
    this.INVOICEAMOUNT = n(data.INVOICEAMOUNT);
    this.ORIGINALINVOICEAMOUNT = n(data.ORIGINALINVOICEAMOUNT);
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
    this.ITEMWITHHOLDINGTAXGROUPCODE = this.compare(
      s(data?.ITEMWITHHOLDINGTAXGROUPCODE),
      '0',
    )
      ? ''
      : s(data?.ITEMWITHHOLDINGTAXGROUPCODE);
    this.DOCUMENTDATE = this.normalizeDate(data?.DOCUMENTDATE);
    this.DUEDATE = this.normalizeDate(data?.DUEDATE);
    this.PAYMENTMETHOD = this.sanitizePaymentMethod(data?.PAYMENTMETHOD);
    this.PAYMENTREFERENCE = s(data?.PAYMENTREFERENCE);
    this.CASHDISCOUNT = Number(n(data?.CASHDISCOUNT)) || 0;
    this.CASHDISCOUNTAMOUNT = Number(n(data?.CASHDISCOUNTAMOUNT)) || 0;
    this.CASHDISCOUNTDATE = this.normalizeDate(data?.CASHDISCOUNTDATE);
    this.OVERRIDESALESTAX = s(data?.OVERRIDESALESTAX);
    this.PAYMENTID = s(data?.PAYMENTID);
    this.QUANTITY = Number(n(data?.QUANTITY)) || 0;
    this.REVERSEDATE = this.normalizeDate(data?.REVERSEDATE);
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

  protected sanitizePaymentMethod(value: LookupCell<any>): string {
    const raw = this.lookupResult<any>(value);
    if (raw == null) return '';
    if (raw instanceof Date) return '';
    const str = this.stripDisallowedChars(String(raw)).trim();
    if (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str) ||
      /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(str) ||
      /^\d{4}-\d{2}-\d{2}T/.test(str)
    ) {
      return '';
    }
    return str;
  }

  /**
   * Normalizes date-like source values into YYYY-MM-DD.
   * Returns empty string if the input cannot be parsed safely.
   */
  protected normalizeDate(value: LookupCell<any>): string {
    const raw = this.lookupResult<any>(value);

    if (raw == null) return '';

    if (raw instanceof Date) {
      return this.toIsoDate(raw);
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw > 0 && raw < 100000) {
        // Excel serial date (1900-based with leap-year bug adjustment).
        const excelEpoch = Date.UTC(1899, 11, 30);
        const date = new Date(excelEpoch + Math.floor(raw) * 86400000);
        return this.toIsoDate(date);
      }

      // Unix timestamp in seconds or milliseconds.
      const ms = raw < 1e12 ? raw * 1000 : raw;
      return this.toIsoDate(new Date(ms));
    }

    if (typeof raw === 'object') return '';

    let input = this.stripDisallowedChars(String(raw)).trim();

    if (!input) return '';

    // Remove wrapping quotes repeatedly.
    while (
      input.length >= 2 &&
      ((input.startsWith('"') && input.endsWith('"')) ||
        (input.startsWith("'") && input.endsWith("'")))
    ) {
      input = input.slice(1, -1).trim();
    }

    if (!input) return '';

    // Fast path for ISO-like values: 2025-12-31 or 2025-12-31T00:00:00.000Z
    const isoPrefix = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoPrefix) {
      const normalized = this.fromYmdParts(
        Number(isoPrefix[1]),
        Number(isoPrefix[2]),
        Number(isoPrefix[3]),
      );
      if (normalized) return normalized;
    }

    // Accept slash or dash separators when year is first, e.g. 2025/12/31
    const ymdLike = input.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (ymdLike) {
      const normalized = this.fromYmdParts(
        Number(ymdLike[1]),
        Number(ymdLike[2]),
        Number(ymdLike[3]),
      );
      if (normalized) return normalized;
    }

    // Accept day-first or month-first patterns, e.g. 31/12/2025 or 12-31-2025.
    const dmyOrMdy = input.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmyOrMdy) {
      const a = Number(dmyOrMdy[1]);
      const b = Number(dmyOrMdy[2]);
      const y = Number(dmyOrMdy[3]);

      // Prefer day-first when unambiguous; otherwise treat as month-first.
      const dayFirst = this.fromYmdParts(y, b, a);
      const monthFirst = this.fromYmdParts(y, a, b);
      if (a > 12 && dayFirst) return dayFirst;
      if (b > 12 && monthFirst) return monthFirst;
      return dayFirst || monthFirst || '';
    }

    // Final fallback to JS Date parser for other recognizable formats.
    const parsed = new Date(input);
    return this.toIsoDate(parsed);
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

  private toIsoDate(date: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private fromYmdParts(year: number, month: number, day: number): string {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1000 ||
      year > 9999
    ) {
      return '';
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return '';
    }

    return date.toISOString().slice(0, 10);
  }

  private stripDisallowedChars(value: string): string {
    let output = '';

    for (const char of value) {
      const code = char.charCodeAt(0);

      const isControl = code <= 31 || code === 127;
      const isZeroWidth = code >= 8203 && code <= 8205;
      const isBom = code === 65279;

      if (!isControl && !isZeroWidth && !isBom) {
        output += char;
      }
    }

    return output;
  }
}
