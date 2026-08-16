import { BadRequestException, Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  CashOutSettlementIntegrityResult,
  CustomerPaymentJournalService,
} from '@/modules/d365fo/services/customer-payment-journal.service';
import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { D365FOCustomerPaymentJournalLineRequest } from '@/modules/d365fo/types/d365fo-customer-payment-journal.type';
import { GetJournalIntegrityQuery } from '@/modules/data-batch/queries/get-journal-integrity.query';
import { DataBatchRepository } from '@/modules/data-batch/repositories/interfaces';
import { QueueJobGroup } from '@/modules/queue/schemas/queue-job-group.schema';

type JsonRecord = Record<string, any>;

interface EntityPair {
  header: string;
  lines: string;
}

interface CurrencyTotals {
  currency: string;
  debit: number;
  credit: number;
  net: number;
}

const ENTITY_PAIRS: EntityPair[] = [
  {
    header: 'VendorPaymentJournalHeaders',
    lines: 'VendorPaymentJournalLines',
  },
  { header: 'LedgerJournalHeaders', lines: 'LedgerJournalLines' },
  {
    header: 'CustomerPaymentJournalHeaders',
    lines: 'CustomerPaymentJournalLines',
  },
  { header: 'VendInvoiceJournalHeaders', lines: 'VendInvoiceJournalLines' },
];

@Injectable()
@QueryHandler(GetJournalIntegrityQuery)
export class GetJournalIntegrityHandler implements IQueryHandler<GetJournalIntegrityQuery> {
  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly dataBatchRepository: DataBatchRepository,
    @InjectModel(QueueJobGroup.name)
    private readonly queueGroups: Model<QueueJobGroup>,
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
  ) {}

  public async execute(query: GetJournalIntegrityQuery): Promise<JsonRecord> {
    const journalBatchNumber = query.journalBatchNumber.trim();
    if (!journalBatchNumber) {
      throw new BadRequestException('Journal batch number is required');
    }

    const [finance, expected] = await Promise.all([
      this.fetchFinanceResponse(journalBatchNumber),
      this.findExpectedPosting(journalBatchNumber),
    ]);
    const actualLines = finance.matches.flatMap((match) => match.lines);
    const actualHeaders = finance.matches.flatMap((match) => match.headers);
    const expectedLines = expected?.lines ?? [];
    const expectedTotals = expected
      ? this.calculateTotals(expectedLines, true)
      : null;
    const actualTotals = this.calculateTotals(actualLines, false);
    const amountComparison = this.compareTotals(expectedTotals, actualTotals);
    const duplicates = this.detectDuplicates(actualLines);
    const lineCountMatches = expected
      ? expectedLines.length === actualLines.length
      : null;
    const amountMatches =
      amountComparison === null
        ? null
        : amountComparison.every((item) => item.matches);
    const hasConfirmedDuplicates =
      duplicates.duplicateLineNumbers.length > 0 ||
      (expected !== null &&
        actualLines.length > expectedLines.length &&
        amountMatches === false &&
        duplicates.potentialBusinessDuplicates.length > 0);

    let settlementAnalysis: CashOutSettlementIntegrityResult | null = null;
    let settlementCheckError: string | null = null;
    const vendorMatch = finance.matches.find(
      (match) => match.headerEntity === 'VendorPaymentJournalHeaders',
    );
    if (expected && vendorMatch) {
      const company = String(
        vendorMatch.headers[0]?.dataAreaId ??
          expected.header?.dataAreaId ??
          expectedLines[0]?.dataAreaId ??
          '',
      );
      try {
        settlementAnalysis =
          await this.customerPaymentJournalService.verifyCashOutSettlementIntegrity(
            journalBatchNumber,
            expectedLines as D365FOCustomerPaymentJournalLineRequest[],
            company,
            false,
          );
      } catch (error) {
        settlementCheckError =
          error instanceof Error ? error.message : String(error);
      }
    }

    const issues: string[] = [];
    const warnings: string[] = [];
    if (actualHeaders.length === 0) {
      issues.push('Journal header was not found in D365FO.');
    } else if (actualHeaders.length > 1) {
      issues.push(
        `Journal number matched ${actualHeaders.length} headers across D365FO entities/companies.`,
      );
    }
    if (expected && expectedLines.length !== actualLines.length) {
      issues.push(
        `Line count mismatch: middleware expected ${expectedLines.length}, Finance contains ${actualLines.length}.`,
      );
    }
    if (amountComparison?.some((item) => !item.matches)) {
      issues.push(
        'One or more Finance currency totals do not match middleware totals.',
      );
    }
    if (duplicates.duplicateLineNumbers.length > 0) {
      issues.push('Finance contains repeated LineNumber values.');
    }
    const alreadyMarkedElsewhere = this.summarizeAlreadyMarkedElsewhere(
      journalBatchNumber,
      actualLines,
      settlementAnalysis,
    );
    if (settlementAnalysis && !settlementAnalysis.matches) {
      if (alreadyMarkedElsewhere.journals.length > 0) {
        warnings.push(alreadyMarkedElsewhere.description);
      } else {
        issues.push(
          `Invoice settlement mismatch: Finance confirmed ${settlementAnalysis.actualCount}/${settlementAnalysis.expectedCount} expected mark(s) on ${journalBatchNumber}.`,
        );
      }
    }
    if (settlementCheckError) {
      issues.push(
        `Invoice settlement integrity could not be verified: ${settlementCheckError}`,
      );
    }
    if (duplicates.potentialBusinessDuplicates.length > 0) {
      warnings.push(
        lineCountMatches === true && amountMatches === true
          ? `${duplicates.potentialBusinessDuplicates.length} repeated business-line signature(s) were found, but Finance line count and amount exactly match the middleware request. They are review candidates, not evidence of extra posting.`
          : `${duplicates.potentialBusinessDuplicates.length} potential duplicated business-line signature(s) were found. Review the returned line numbers.`,
      );
    }
    if (!expected) {
      warnings.push(
        'No durable middleware posting group was found for this journal; Finance totals are returned but cannot be compared with the original request.',
      );
    }

    const status =
      issues.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARNING' : 'PASS';

    return {
      journalBatchNumber,
      status,
      isAmountCorrect: amountComparison === null ? null : amountMatches,
      isSettlementCorrect: settlementAnalysis?.matches ?? null,
      hasDuplicates: hasConfirmedDuplicates,
      hasPotentialDuplicates: duplicates.potentialBusinessDuplicates.length > 0,
      duplicationConclusion: hasConfirmedDuplicates
        ? 'CONFIRMED_DUPLICATION'
        : lineCountMatches === true && amountMatches === true
          ? 'NO_EXTRA_FINANCE_DATA'
          : expected === null
            ? 'NOT_COMPARABLE'
            : 'REVIEW_REQUIRED',
      issues,
      warnings,
      summary: {
        headerCount: actualHeaders.length,
        matchedEntityCount: finance.matches.length,
        expectedLineCount: expected ? expectedLines.length : null,
        actualLineCount: actualLines.length,
        lineCountMatches,
        expectedTotalsByCurrency: expectedTotals,
        actualTotalsByCurrency: actualTotals,
        amountComparisonByCurrency: amountComparison,
      },
      duplicationAnalysis: duplicates,
      alreadyMarkedElsewhere,
      settlementAnalysis,
      middleware: expected
        ? {
            batchId: expected.batchId,
            durableJobId: expected.jobId,
            groupIndex: expected.index,
            groupStatus: expected.status,
            expectedHeader: expected.header,
            expectedLines,
          }
        : null,
      finance: {
        queriedEntities: ENTITY_PAIRS,
        matches: finance.matches,
        fullResponseByEntity: finance.fullResponseByEntity,
      },
    };
  }

  private async fetchFinanceResponse(journalBatchNumber: string): Promise<{
    matches: Array<{
      headerEntity: string;
      lineEntity: string;
      headers: JsonRecord[];
      lines: JsonRecord[];
    }>;
    fullResponseByEntity: Record<string, JsonRecord>;
  }> {
    const escaped = journalBatchNumber.replace(/'/g, "''");
    const filter = encodeURIComponent(`JournalBatchNumber eq '${escaped}'`);
    const matches: Array<{
      headerEntity: string;
      lineEntity: string;
      headers: JsonRecord[];
      lines: JsonRecord[];
    }> = [];
    const fullResponseByEntity: Record<string, JsonRecord> = {};

    for (const pair of ENTITY_PAIRS) {
      try {
        const headerResponse = await this.d365foClient.get<JsonRecord>(
          `/data/${pair.header}?cross-company=true&$filter=${filter}&$top=100`,
          { useCache: false },
        );
        fullResponseByEntity[pair.header] = headerResponse;
        const headers = headerResponse.value ?? [];
        if (headers.length === 0) continue;

        const lineResponse = await this.d365foClient.get<JsonRecord>(
          `/data/${pair.lines}?cross-company=true&$filter=${filter}&$top=10000`,
          { useCache: false },
        );
        fullResponseByEntity[pair.lines] = lineResponse;
        const lines = lineResponse.value ?? [];
        this.enrichFinanceLineMarks(lines);
        await this.applySettledInvoiceChildren(journalBatchNumber, lines);
        matches.push({
          headerEntity: pair.header,
          lineEntity: pair.lines,
          headers,
          lines,
        });
      } catch (error) {
        fullResponseByEntity[pair.header] = {
          queryError: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return { matches, fullResponseByEntity };
  }

  /**
   * FO OData leaves VendorPaymentJournalLines.MarkedLines as [] unless the
   * navigation is expanded. The mark actually lives on MarkedInvoice /
   * SettleVoucher / VendorPaymentJournalLineSettledInvoices. Copy those into
   * MarkedLines so Postman and the UI show the real invoices.
   */
  private enrichFinanceLineMarks(lines: JsonRecord[]): void {
    for (const line of lines) {
      const existing = Array.isArray(line.MarkedLines) ? line.MarkedLines : [];
      const hasInvoice = existing.some((marked) =>
        Boolean(String(marked?.InvoiceNumber ?? '').trim()),
      );
      if (hasInvoice) continue;
      const invoice = String(line.MarkedInvoice ?? '').trim();
      line.MarkedLines = invoice
        ? [
            {
              InvoiceNumber: invoice,
              SettleVoucher: line.SettleVoucher || 'SelectedTransact',
            },
          ]
        : [];
    }
  }

  private async applySettledInvoiceChildren(
    journalBatchNumber: string,
    lines: JsonRecord[],
  ): Promise<void> {
    if (!lines.length) return;
    const escaped = journalBatchNumber.replace(/'/g, "''");
    const filter = encodeURIComponent(`JournalBatchNumber eq '${escaped}'`);
    try {
      const response = await this.d365foClient.get<JsonRecord>(
        `/data/VendorPaymentJournalLineSettledInvoices?cross-company=true&$filter=${filter}&$top=10000`,
        { useCache: false },
      );
      const children = response.value ?? [];
      if (!children.length) return;
      const invoicesByLine = new Map<string, string[]>();
      for (const child of children) {
        const lineNumber = String(
          child.JournalLineNumber ?? child.LineNumber ?? '',
        ).trim();
        const invoice = String(child.InvoiceNumber ?? '').trim();
        if (!lineNumber || !invoice) continue;
        invoicesByLine.set(lineNumber, [
          ...(invoicesByLine.get(lineNumber) ?? []),
          invoice,
        ]);
      }
      for (const line of lines) {
        const extras = invoicesByLine.get(String(line.LineNumber ?? '').trim());
        if (!extras?.length) continue;
        const markedLines = Array.isArray(line.MarkedLines)
          ? [...line.MarkedLines]
          : [];
        const seen = new Set(
          markedLines.map((marked) =>
            String(marked?.InvoiceNumber ?? '')
              .trim()
              .toLowerCase(),
          ),
        );
        for (const invoice of extras) {
          if (seen.has(invoice.toLowerCase())) continue;
          seen.add(invoice.toLowerCase());
          markedLines.push({
            InvoiceNumber: invoice,
            SettleVoucher: 'SelectedTransact',
          });
        }
        line.MarkedLines = markedLines;
        if (!String(line.MarkedInvoice ?? '').trim() && markedLines[0]) {
          line.MarkedInvoice = markedLines[0].InvoiceNumber;
        }
      }
    } catch {
      // Child entity is optional; MarkedInvoice enrichment still applies.
    }
  }

  private summarizeAlreadyMarkedElsewhere(
    journalBatchNumber: string,
    actualLines: JsonRecord[],
    settlementAnalysis: CashOutSettlementIntegrityResult | null,
  ): {
    thisJournalMarkedLineCount: number;
    journals: Array<{ journalBatchNumber: string; invoiceCount: number }>;
    description: string;
  } {
    const thisJournalNorm = journalBatchNumber.trim().toLowerCase();
    const thisJournalMarkedLineCount = actualLines.filter((line) =>
      this.lineHasInvoiceMark(line),
    ).length;
    const counts = new Map<string, number>();
    for (const blocker of settlementAnalysis?.blockers ?? []) {
      const owner = String(blocker.journalBatchNumber ?? '').trim();
      if (!owner || owner.toLowerCase() === thisJournalNorm) continue;
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    const journals = [...counts.entries()]
      .map(([owner, invoiceCount]) => ({
        journalBatchNumber: owner,
        invoiceCount,
      }))
      .sort((left, right) => right.invoiceCount - left.invoiceCount);
    const journalList = journals
      .map((item) => `${item.journalBatchNumber} (${item.invoiceCount})`)
      .join(', ');
    const description = journals.length
      ? `These invoices are already marked in Finance on ${journalList}. Post those journals. ${journalBatchNumber} has payment lines, but the invoice marks belong to the earlier journals.`
      : thisJournalMarkedLineCount === 0
        ? `No invoice marks were found on ${journalBatchNumber}. If this file was posted more than once, the marks are on an earlier Finance journal.`
        : `${thisJournalMarkedLineCount} line(s) on ${journalBatchNumber} already have invoice marks in Finance.`;
    return { thisJournalMarkedLineCount, journals, description };
  }

  private lineHasInvoiceMark(line: JsonRecord): boolean {
    if (String(line.MarkedInvoice ?? '').trim()) return true;
    if (String(line.SettleVoucher ?? '') === 'SelectedTransact') return true;
    const markedLines = line.MarkedLines;
    return (
      Array.isArray(markedLines) &&
      markedLines.some((marked) =>
        Boolean(String(marked?.InvoiceNumber ?? '').trim()),
      )
    );
  }

  private async findExpectedPosting(journalBatchNumber: string): Promise<{
    batchId: string | null;
    jobId: string;
    index: number;
    status: string;
    header: JsonRecord | null;
    lines: JsonRecord[];
  } | null> {
    const group = await this.queueGroups
      .findOne({ createdHeaderId: journalBatchNumber })
      .sort({ updatedAt: -1 })
      .lean();

    if (group) {
      const payload = (group.payload ?? {}) as JsonRecord;
      return {
        batchId: this.batchIdFromJobId(group.jobId),
        jobId: group.jobId,
        index: group.index,
        status: group.status,
        header: (payload.header as JsonRecord | undefined) ?? null,
        lines: Array.isArray(payload.lines) ? payload.lines : [],
      };
    }

    const batches = await this.dataBatchRepository.getList(
      { batchNumberIds: [journalBatchNumber] },
      { maxCount: 1 },
    );
    if (!batches.length) return null;
    return {
      batchId: batches[0].id,
      jobId: '',
      index: -1,
      status: 'unknown',
      header: null,
      lines: [],
    };
  }

  private batchIdFromJobId(jobId: string): string | null {
    const match = jobId.match(/--([a-f\d]{24})$/i);
    return match?.[1] ?? null;
  }

  private calculateTotals(
    lines: JsonRecord[],
    expected: boolean,
  ): CurrencyTotals[] {
    const totals = new Map<string, { debit: number; credit: number }>();
    for (const sourceLine of lines) {
      const line = expected
        ? ((sourceLine.customLineApiBody as JsonRecord | undefined) ??
          sourceLine)
        : sourceLine;
      const currency = this.primitiveString(
        this.firstValue(line, ['CurrencyCode', 'currency', 'Currency']),
        'UNKNOWN',
      )
        .trim()
        .toUpperCase();
      const current = totals.get(currency) ?? { debit: 0, credit: 0 };
      current.debit += this.amountValue(line, [
        'DebitAmount',
        'debitAmount',
        'AmountCurDebit',
      ]);
      current.credit += this.amountValue(line, [
        'CreditAmount',
        'creditAmount',
        'AmountCurCredit',
      ]);
      totals.set(currency, current);
    }

    return [...totals.entries()]
      .map(([currency, value]) => ({
        currency,
        debit: this.round(value.debit),
        credit: this.round(value.credit),
        net: this.round(value.debit - value.credit),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private compareTotals(
    expected: CurrencyTotals[] | null,
    actual: CurrencyTotals[],
  ): JsonRecord[] | null {
    if (expected === null) return null;
    const expectedMap = new Map(expected.map((item) => [item.currency, item]));
    const actualMap = new Map(actual.map((item) => [item.currency, item]));
    const currencies = [
      ...new Set([...expectedMap.keys(), ...actualMap.keys()]),
    ].sort();

    return currencies.map((currency) => {
      const left = expectedMap.get(currency) ?? {
        debit: 0,
        credit: 0,
        net: 0,
      };
      const right = actualMap.get(currency) ?? {
        debit: 0,
        credit: 0,
        net: 0,
      };
      const debitDifference = this.round(right.debit - left.debit);
      const creditDifference = this.round(right.credit - left.credit);
      const netDifference = this.round(right.net - left.net);
      return {
        currency,
        expectedDebit: left.debit,
        actualDebit: right.debit,
        debitDifference,
        expectedCredit: left.credit,
        actualCredit: right.credit,
        creditDifference,
        expectedNet: left.net,
        actualNet: right.net,
        netDifference,
        matches:
          Math.abs(debitDifference) <= 0.01 &&
          Math.abs(creditDifference) <= 0.01,
      };
    });
  }

  private detectDuplicates(lines: JsonRecord[]): {
    duplicateLineNumbers: Array<{
      company: string;
      lineNumber: number | string;
      occurrences: number;
    }>;
    potentialBusinessDuplicates: Array<{
      occurrences: number;
      lineNumbers: Array<number | string>;
      signature: JsonRecord;
    }>;
  } {
    const lineNumberGroups = new Map<string, JsonRecord[]>();
    const signatureGroups = new Map<
      string,
      { signature: JsonRecord; lines: JsonRecord[] }
    >();

    for (const line of lines) {
      const company = String(line.dataAreaId ?? line.Company ?? '');
      const lineNumber = line.LineNumber ?? '';
      const lineKey = `${company}|${lineNumber}`;
      lineNumberGroups.set(lineKey, [
        ...(lineNumberGroups.get(lineKey) ?? []),
        line,
      ]);

      const signature = {
        company,
        account: line.AccountDisplayValue ?? '',
        paymentId: line.PaymentId ?? line.PAYMENTID ?? '',
        currency: line.CurrencyCode ?? line.currency ?? '',
        debit: this.amountValue(line, ['DebitAmount', 'debitAmount']),
        credit: this.amountValue(line, ['CreditAmount', 'creditAmount']),
        paymentReference: line.PaymentReference ?? line.PAYMENTREFERENCE ?? '',
        markedInvoice: line.MarkedInvoice ?? '',
        finTag: line.FinTagDisplayValue ?? line.FinTagStr ?? '',
        offsetFinTag:
          line.OffsetFinTagDisplayValue ?? line.OFFSETFINTAGDISPLAYVALUE ?? '',
        offsetAccount:
          line.OffsetAccountDisplayValue ??
          line.offsetAccountDisplayValue ??
          '',
        transactionDate: line.TransactionDate ?? line.transDate ?? '',
        transactionText: line.TransactionText ?? line.TRANSACTIONTEXT ?? '',
      };
      const signatureKey = JSON.stringify(signature);
      const group: { signature: JsonRecord; lines: JsonRecord[] } =
        signatureGroups.get(signatureKey) ?? {
          signature,
          lines: [],
        };
      group.lines.push(line);
      signatureGroups.set(signatureKey, group);
    }

    return {
      duplicateLineNumbers: [...lineNumberGroups.entries()]
        .filter(([, grouped]) => grouped.length > 1)
        .map(([key, grouped]) => {
          const separator = key.indexOf('|');
          return {
            company: key.slice(0, separator),
            lineNumber: key.slice(separator + 1),
            occurrences: grouped.length,
          };
        }),
      potentialBusinessDuplicates: [...signatureGroups.values()]
        .filter((group) => group.lines.length > 1)
        .map((group) => ({
          occurrences: group.lines.length,
          lineNumbers: group.lines.map((line) => line.LineNumber ?? ''),
          signature: group.signature,
        })),
    };
  }

  private amountValue(record: JsonRecord, keys: string[]): number {
    const value = this.firstValue(record, keys);
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private firstValue(record: JsonRecord, keys: string[]): unknown {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
  }

  private primitiveString(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return fallback;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  }
}
