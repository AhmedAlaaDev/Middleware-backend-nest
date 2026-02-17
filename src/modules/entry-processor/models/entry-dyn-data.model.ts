import { EntryAccountType } from '@/common/types/entry-account.type';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

/**
 * Mapped (dyn) line after format/enrich. Shared properties across
 * cash-in DFO, cash-out DFO, vendor DFO, DynAccountReceivableLineDto,
 * DynLedgerClosingJournalEntryDto, and DynCustodySettlementJournalEntryDto.
 * Naming: PascalCase.
 */
export class EntryDynDataModel {
  /** Line number within batch/journal */
  LineNumber: number;
  /** Journal batch number */
  JournalBatchNumber: string;
  /** Voucher number */
  Voucher: string;
  /** Source row ids for traceability (e.g. from RawDataModel.UniqueId) */
  SourceIds: string[] = [];
  /** Dimension model for validation/posting */
  DimensionModel: EntryDimensionsModel;
  /** Transaction date */
  TransactionDate: string;
  /** Journal name */
  JournalName: string;
  /** Description */
  Description: string;
  /** Account type */
  AccountType: EntryAccountType;

  private errors: Array<{ property: string; message: string }> = [];

  constructor(
    data: Partial<EntryDynDataModel>,
    dimensionModel: EntryDimensionsModel,
  ) {
    this.SourceIds = data.SourceIds || [];
    this.LineNumber = data.LineNumber || 0;
    this.JournalBatchNumber = data.JournalBatchNumber || '';
    this.Voucher = data.Voucher || '';
    this.DimensionModel = dimensionModel;
    this.AccountType = data.AccountType || ('' as EntryAccountType);
    this.TransactionDate = data.TransactionDate || '';
    this.JournalName = data.JournalName || '';
    this.Description = data.Description || '';
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
