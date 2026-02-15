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
  LINENUMBER: string;
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
  ACCOUNTTYPE: string;
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
  /** Journal batch number (optional on AR free-text lines) */
  BatchNumber: string;
  /** Voucher number (optional on AR free-text lines) */
  Voucher: string;
  /** Source row ids for traceability (e.g. from RawDataModel.UniqueId) */
  SourceIds: string[] = [];
  /** Dimension model for validation/posting */
  DimensionModel: AccountDimensionsModel;

  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: RawDataModel, dimensionModel: AccountDimensionsModel) {
    this.SourceIds = data.UniqueId ? [String(data.UniqueId)] : [];
    this.LineNumber = data.LINENUMBER ? Number(data.LINENUMBER) : 0;
    this.BatchNumber = data.JOURNALBATCHNUMBER || '';
    this.Voucher = data.VOUCHER || '';
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
