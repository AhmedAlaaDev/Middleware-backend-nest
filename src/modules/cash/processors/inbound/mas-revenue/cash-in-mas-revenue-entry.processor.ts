import { Injectable } from '@nestjs/common';

import {
  masRevenueIdentity,
  masRevenuePaymentIdBase,
} from '@/modules/cash/mas-revenue/mas-revenue-identity';
import {
  masRevenueJournalBatchNumber,
  MAS_REVENUE_MAX_LINES_PER_JOURNAL,
  type MasRevenueStoredRaw,
} from '@/modules/cash/mas-revenue/mas-revenue-stored';
import { MAS_REVENUE_COMPANY_ID } from '@/modules/cash/mas-revenue/mas-revenue.constants';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  EntryDimensionsModel,
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';

/** Reads a text field without stringifying objects. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * MAS Revenue Cash In processor.
 *
 * It does not use the Cash-In customer, invoice, dimension or AR routing
 * pipeline. Each stored receipt becomes one inbound line: an RCash debit with a
 * Ledger offset, to be posted through the GL route. Account IDs, dimensions,
 * the journal name and exchange rates are resolved from verified MAS
 * configuration at submit and post time, never guessed here.
 */
@Injectable()
export class CashInMasRevenueEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType = EntryProcessorTypes.CashInMasRevenue;

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: false,
    Activity: false,
    CostCenters: false,
    BusinessUnit: false,
    Location: false,
    Customer: false,
    SubCustomer: false,
    ChargeType: false,
    SalesMan: false,
    CoordinatorMan: false,
    FreightType: false,
    Direction: false,
  };

  constructor(baseDeps: EntryProcessorBaseDependencies) {
    super({ dependencies: baseDeps });
  }

  // The base class contract is async; this method has no I/O to await.
  // eslint-disable-next-line @typescript-eslint/require-await
  public async formatAndEnrichAsync(
    data: EntryRawDataModel[],
    company: string,
  ): Promise<EntryDynDataModel[]> {
    this.company = company;
    const rows = [...(data as unknown as MasRevenueStoredRaw[])].sort(
      (a, b) =>
        a.TransactionDate.localeCompare(b.TransactionDate) ||
        a.SourceRow - b.SourceRow,
    );

    // Journals are numbered per month. A journal holds one journal name (the header has
    // one) and at most MAS_REVENUE_MAX_LINES_PER_JOURNAL lines, so a new journal starts
    // when the name changes or the journal is full. Rows of the source layout have no
    // journal name and number exactly as before.
    const journalsPerMonth = new Map<string, number>();
    const openJournal = new Map<string, { number: number; lines: number }>();

    return rows.map((row, index) => {
      const month = row.TransactionDate.slice(0, 7);
      const journalLine = row.JournalLine;
      const groupKey = `${month}|${journalLine?.journalName ?? ''}`;
      let journal = openJournal.get(groupKey);
      if (!journal || journal.lines >= MAS_REVENUE_MAX_LINES_PER_JOURNAL) {
        const next = (journalsPerMonth.get(month) ?? 0) + 1;
        journalsPerMonth.set(month, next);
        journal = { number: next, lines: 0 };
        openJournal.set(groupKey, journal);
      }
      journal.lines += 1;
      const chunk = journal.number;
      const lineNumber = index + 1;
      const amount = row.TotalMinor / 100;

      // The base constructor copies only its own known fields; the MAS fields are assigned below.
      return Object.assign(
        new EntryDynDataModel({}, new EntryDimensionsModel()),
        {
          LineNumber: lineNumber,
          SourceIds: [String(row.SourceRow)],
          dataAreaId: MAS_REVENUE_COMPANY_ID,
          Company: MAS_REVENUE_COMPANY_ID,
          JournalBatchNumber: masRevenueJournalBatchNumber(
            row.TransactionDate,
            chunk,
          ),
          JournalName: journalLine?.journalName ?? '',
          Invoice: row.InvoiceNumber,
          DocumentNum: row.InvoiceNumber,
          PAYMENTID: masRevenuePaymentIdBase({
            invoiceNumber: row.InvoiceNumber,
            transactionDate: row.TransactionDate,
            identityVersion: row.IdentityVersion,
          }),
          // Version 2 batches record the canonical identity (company, namespace, year, invoice).
          IntegrationIdentity:
            row.IdentityVersion === 2
              ? masRevenueIdentity({
                  transactionDate: row.TransactionDate,
                  invoiceNumber: row.InvoiceNumber,
                }).key
              : null,
          IdentityVersion: row.IdentityVersion ?? 1,
          AccountType: journalLine?.accountType ?? 'RCash',
          AccountDisplayValue:
            journalLine?.account ?? row.CashAccountDisplayName,
          OffsetAccountType: journalLine?.offsetAccountType ?? 'Ledger',
          OffsetAccountDisplayValue: journalLine?.offsetAccount ?? '',
          Currency: row.Currency,
          CurrencyCode: row.Currency,
          TransDate: row.TransactionDate,
          TransactionDate: row.TransactionDate,
          DocumentDate: row.TransactionDate,
          Date: row.TransactionDate,
          DebitAmount:
            journalLine && journalLine.side === 'credit' ? 0 : amount,
          CreditAmount:
            journalLine && journalLine.side === 'credit' ? amount : 0,
          ValueAmount: row.ValueMinor / 100,
          VatAmount: row.VatMinor / 100,
          TotalAmount: row.TotalMinor / 100,
          Description: row.CustomerName,
          CustomerName: row.CustomerName,
          SourceRow: row.SourceRow,
          SourceSheet: row.SourceSheet,
          ContainerType: row.ContainerType,
          ContainerNumber: row.ContainerNumber,
          BillOfLading: row.BillOfLading,
          RevenueType: row.RevenueType,
          SeaLine: row.SeaLine,
          VatCardNumber: row.VatCardNumber,
          UniqueId: index + 1,
          // The exact receipt snapshot. Posting reads this, not the display fields above.
          MasRevenueRaw: row,
        },
      ) as EntryDynDataModel;
    });
  }

  /**
   * Data checks only. What D365 must confirm (cash accounts, ledger accounts, tax
   * groups, rates, deployed compatibility) is checked before posting, not here.
   */
  public validateAsync(
    data: EntryDynDataModel[],
    _company: string,
  ): EntryDynDataModel[] {
    for (const line of data) {
      const fields = line as unknown as Record<string, unknown>;
      if (!textOf(fields.Invoice).trim()) {
        line.AddError('Invoice', 'invoice number is required');
      }
      if (!textOf(fields.AccountDisplayValue).trim()) {
        line.AddError('AccountDisplayValue', 'cash account is required');
      }
      // The currency is the D365 cash account's currency and is resolved at posting time.
      // An unresolved currency is a posting blocker, not a line error, so the batch can still
      // be posted once the account is found.
      const journalLine = (
        fields.MasRevenueRaw as MasRevenueStoredRaw | undefined
      )?.JournalLine;
      if (journalLine) {
        // The amount sits on the row's side; the other column must be zero.
        const onSide = Number(
          journalLine.side === 'credit'
            ? fields.CreditAmount
            : fields.DebitAmount,
        );
        const other = Number(
          journalLine.side === 'credit'
            ? fields.DebitAmount
            : fields.CreditAmount,
        );
        if (!(onSide > 0)) {
          line.AddError('Amount', 'amount must be greater than zero');
        }
        if (other !== 0) {
          line.AddError(
            'Amount',
            'only one of debit or credit may be used on a row',
          );
        }
        continue;
      }
      if (!(Number(fields.DebitAmount) > 0)) {
        line.AddError(
          'DebitAmount',
          'receipt amount must be greater than zero',
        );
      }
      if (Number(fields.CreditAmount ?? 0) !== 0) {
        line.AddError('CreditAmount', 'credit must be zero in this flow');
      }
    }
    return data;
  }

  /** Posting never goes through this method. Lines are posted by the PostToDFO queue. */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async insertIntoDynamicsAsync(): Promise<void> {
    throw new Error(
      'MAS Revenue lines are posted through the PostToDFO queue, not inserted directly',
    );
  }
}
