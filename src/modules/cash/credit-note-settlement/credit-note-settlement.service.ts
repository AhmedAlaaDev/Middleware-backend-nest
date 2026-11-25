import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants/entry-processor-names.constant';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

import {
  buildCreditNoteSettlementLines,
  creditNoteSettlementSourceRows,
} from './credit-note-settlement.lines';
import {
  CreditNoteSettlementRow,
  CreditNoteSettlementTemplateError,
  parseCreditNoteSettlementWorkbook,
} from './credit-note-settlement.parser';
import {
  CreditNoteSettlementD365Reader,
  reviewCreditNoteSettlements,
} from './credit-note-settlement.review';

/** One pair read back from a stored batch, for the pre-post check. */
export interface StoredSettlementPair {
  sourceRow: number;
  customer: string;
  creditNoteInvoice: string;
  originalInvoice: string;
  currency: string;
  amount: number;
}

@Injectable()
export class CreditNoteSettlementService {
  private readonly logger = new Logger(CreditNoteSettlementService.name);

  constructor(
    private readonly reader: CreditNoteSettlementD365Reader,
    private readonly dataBatchService: DataBatchService,
  ) {}

  /**
   * Parses the template, checks every pair against D365 (read-only) and stores
   * the standard batch. Blocked pairs are stored as batch errors, so the batch
   * pages show them and the post refuses the batch until they are fixed.
   */
  public async upload(input: {
    fileBuffer: Buffer<ArrayBufferLike>;
    fileName: string;
    companyId: string;
    postingDate?: string;
  }): Promise<IDataBatch> {
    const company = String(input.companyId ?? '').trim() || 'm-p';
    let rows: CreditNoteSettlementRow[];
    try {
      ({ rows } = await parseCreditNoteSettlementWorkbook(input.fileBuffer));
    } catch (error) {
      if (error instanceof CreditNoteSettlementTemplateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const lookups = await this.reader.read(company, rows);
    const pairs = reviewCreditNoteSettlements(rows, lookups);
    const postingDate =
      input.postingDate ?? new Date().toISOString().slice(0, 10);
    const lines = buildCreditNoteSettlementLines(pairs, company, postingDate);

    const blocked = pairs.filter((pair) => pair.status !== 'VALID').length;
    this.logger.log(
      JSON.stringify({
        event: 'credit_note_settlement.upload',
        company,
        pairs: pairs.length,
        blocked,
        lines: lines.length,
      }),
    );

    return this.dataBatchService.createAsync(
      EntryProcessorTypes.CashInCreditNoteSettlement,
      ENTRY_PROCESSOR_NAMES.CASH_IN_CREDIT_NOTE_SETTLEMENT,
      company,
      input.fileName,
      creditNoteSettlementSourceRows(pairs) as unknown as EntryRawDataModel[],
      lines,
    );
  }

  /**
   * Checks the stored pairs against D365 again just before posting. Returns one
   * message per pair that no longer settles (closed, changed or already used).
   */
  public async recheck(
    company: string,
    pairs: StoredSettlementPair[],
  ): Promise<Array<{ sourceRow: number; problem: string }>> {
    const rows: CreditNoteSettlementRow[] = pairs.map((pair) => ({
      sourceRow: pair.sourceRow,
      creditNoteVoucher: '',
      creditNoteInvoice: pair.creditNoteInvoice,
      customer: pair.customer,
      creditNoteAmount: null,
      originalVoucher: '',
      originalInvoice: pair.originalInvoice,
      originalAmount: null,
      currency: pair.currency,
      settleAmount: pair.amount,
      notes: '',
      errors: [],
    }));
    const lookups = await this.reader.read(company, rows);
    return reviewCreditNoteSettlements(rows, lookups)
      .filter((pair) => pair.status !== 'VALID')
      .flatMap((pair) =>
        pair.errors.map((problem) => ({
          sourceRow: pair.row.sourceRow,
          problem,
        })),
      );
  }
}

/**
 * Rebuilds the pairs from stored batch lines: the debit line of a pair marks the
 * credit note and the credit line marks the invoice; both carry the source row.
 */
export function storedSettlementPairs(
  lines: CashEntryDynDataModel[],
): StoredSettlementPair[] {
  const byRow = new Map<number, StoredSettlementPair>();
  for (const line of lines) {
    const sourceRow = Number(line.SourceLineNumber ?? 0);
    if (!(sourceRow > 0)) continue;
    const pair = byRow.get(sourceRow) ?? {
      sourceRow,
      customer: String(line.AccountDisplayValue ?? '').trim(),
      creditNoteInvoice: '',
      originalInvoice: '',
      currency: String(line.CurrencyCode ?? '')
        .trim()
        .toUpperCase(),
      amount: 0,
    };
    const invoice = String(line.MarkedInvoice ?? line.Invoice ?? '').trim();
    if (Number(line.DebitAmount ?? 0) > 0) {
      pair.creditNoteInvoice = invoice;
      pair.amount = Number(line.DebitAmount);
    } else if (Number(line.CreditAmount ?? 0) > 0) {
      pair.originalInvoice = invoice;
    }
    byRow.set(sourceRow, pair);
  }
  return [...byRow.values()];
}
