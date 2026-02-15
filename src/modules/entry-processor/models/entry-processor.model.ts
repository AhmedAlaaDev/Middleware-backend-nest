import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

type LookupCell<T = any> = { formula?: string; result?: T } | T;

/**
 * Source (raw) row from import (e.g. Excel/CSV).
 * Shared properties across cash-in, cash-out, vendor, account-receivable,
 * ledger-closing, and custody-settlement raw models.
 * Naming: UPPERCASE for source fields; UniqueId remains PascalCase.
 */
export class RawDataModel {
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
  ACCOUNTTYPE: 'Cust' | 'Ledger' | 'Vend' | 'Bank' | 'Petty cash';
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

  /** Other fields from the source data */
  [key: string]: any;

  constructor(data: Partial<RawDataModel>) {
    const s = (v: unknown) => this.lookupResultAsString(v);
    const n = (v: unknown) => this.lookupResultAsNumber(v);

    this.UniqueId = n(data.UniqueId);
    this.LINENUMBER = n(data.LINENUMBER);
    this.JOURNALBATCHNUMBER = s(data.JOURNALBATCHNUMBER);
    this.VOUCHER = s(data.VOUCHER);
    this.TRANSDATE = s(data.TRANSDATE);
    this.JOURNALNAME = s(data.JOURNALNAME);
    this.DESCRIPTION = s(data.DESCRIPTION);
    this.ACCOUNTTYPE = s(data.ACCOUNTTYPE) as
      | 'Cust'
      | 'Ledger'
      | 'Vend'
      | 'Bank'
      | 'Petty cash';
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

/**
 * Mapped (dyn) line after format/enrich. Shared properties across
 * cash-in DFO, cash-out DFO, vendor DFO, DynAccountReceivableLineDto,
 * DynLedgerClosingJournalEntryDto, and DynCustodySettlementJournalEntryDto.
 * Naming: PascalCase.
 */
export class DynDataModel {
  /** Line number within batch/journal */
  LineNumber: number;
  /** Journal batch number */
  JournalBatchNumber: string;
  /** Voucher number */
  Voucher: string;
  /** Source row ids for traceability (e.g. from RawDataModel.UniqueId) */
  SourceIds: string[] = [];
  /** Dimension model for validation/posting */
  DimensionModel: AccountDimensionsModel;
  /** Transaction date */
  TransactionDate: string;
  /** Journal name */
  JournalName: string;
  /** Description */
  Description: string;

  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: DynDataModel, dimensionModel: AccountDimensionsModel) {
    this.SourceIds = data.SourceIds;
    this.LineNumber = data.LineNumber;
    this.JournalBatchNumber = data.JournalBatchNumber;
    this.Voucher = data.Voucher;
    this.DimensionModel = dimensionModel;
  }

  public get ErrorCount(): number {
    return this.errors.length;
  }

  public get ErrorsText(): string {
    if (this.errors.length === 0) return '';
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  public AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  public GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}
