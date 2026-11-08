/**
 * Opt-in replay of a real Custody Settlement workbook through the production
 * pipeline: parser/classifier/processor (formatAndEnrichAsync) -> posting
 * handler mapping -> the posting service's real request grouping -> X++
 * voucher rule. No D365 call is made.
 *
 *   CUST_FILE=/path/to/workbook.xlsx pnpm jest custody-settlement.workbook-replay
 *
 * Optional: CUST_OUT=/path/summary.json writes a per-UniqueId reconciliation.
 * Skipped when CUST_FILE is not set (workbooks carry financial data and are
 * not committed). D365-backed lookups (vendor groups, invoice snapshots,
 * dimension master data, exchange rates) are stubbed; everything else is real.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import {
  ActualJournalLine,
  reconcileExistingJournalLines,
  toPlannedJournalLine,
} from '@/modules/d365fo/services/cash-journal-line-identity';
import { verifyJournalContent } from '@/modules/d365fo/services/cash-journal-readback';
import {
  simulateCashOutVouchers,
  toCashOutCents,
} from '@/modules/d365fo/services/cash-out-request-grouping';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';
import { CashJournalPostingStrategy } from '@/modules/queue/strategies/cash-journal-posting.strategy';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs');

const FILE = process.env.CUST_FILE;

async function readRows(file: string): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  const headers: string[] = sheet
    .getRow(1)
    .values.slice(1)
    .map((h: any) => String(h && h.result !== undefined ? h.result : h));
  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row: any, index: number) => {
    if (index === 1) return;
    const values = row.values.slice(1);
    const record: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      let value = values[i];
      if (value && typeof value === 'object' && 'result' in value) {
        value = value.result;
      }
      record[header] = value;
    });
    rows.push(record);
  });
  return rows;
}

(FILE ? describe : describe.skip)('Custody Settlement workbook replay', () => {
  it('reconciles every UniqueId through the real planner', async () => {
    const rows = await readRows(FILE as string);
    const vendors = [
      ...new Set(
        rows
          .filter((r) => String(r.ACCOUNTTYPE).toLowerCase().startsWith('vend'))
          .map((r) => String(r.ACCOUNTDISPLAYVALUE)),
      ),
    ].map((account) => ({
      vendorAccountNumber: account,
      vendorGroupId: process.env.CUST_VENDOR_GROUP ?? 'Normal',
    }));

    const processor: any = new CashOutFreightEntryProcessor(
      { execute: jest.fn().mockResolvedValue({ items: vendors }) } as any,
      {
        queryBus: { execute: jest.fn().mockResolvedValue({ items: vendors }) },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService: {
          load: jest.fn().mockResolvedValue(undefined),
          resolveReporting: jest.fn(),
        },
      } as any,
    );
    processor.company = 'm-p';
    processor.vendorNameMap = new Map();
    jest.spyOn(processor, 'warmupProcessorData').mockResolvedValue(undefined);
    jest
      .spyOn(processor, 'collectSettlementTargetErrors')
      .mockResolvedValue(undefined);
    jest
      .spyOn(processor, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    jest
      .spyOn(processor, 'validateCashOutMarkedInvoice')
      .mockImplementation(() => undefined);
    jest
      .spyOn(processor, 'fetchVendorInvoiceExistsMap')
      .mockResolvedValue(undefined);
    jest
      .spyOn(processor, 'fetchExchangeRates')
      .mockReturnValue({ exchangeRate: 1, reportingRate: 1 });

    // ---- format stage -------------------------------------------------
    const formatted: any[] = processor.validateAsync(
      await processor.formatAndEnrichAsync(rows, 'm-p'),
      'm-p',
    );
    expect(formatted.filter((l) => l.GetErrors().length)).toHaveLength(0);

    const source = new Map<string, { n: number; dr: number; cr: number }>();
    for (const row of rows) {
      const id = String(row.UniqueId);
      const entry = source.get(id) ?? { n: 0, dr: 0, cr: 0 };
      entry.n++;
      entry.dr += toCashOutCents(row.DEBITAMOUNT);
      entry.cr += toCashOutCents(row.CREDITAMOUNT);
      source.set(id, entry);
    }
    const generated = new Map<
      string,
      { n: number; dr: number; cr: number; batches: Set<string> }
    >();
    for (const line of formatted) {
      const id = String(line.SourceIds?.[0]);
      const entry = generated.get(id) ?? {
        n: 0,
        dr: 0,
        cr: 0,
        batches: new Set<string>(),
      };
      entry.n++;
      entry.dr += toCashOutCents(line.DebitAmount);
      entry.cr += toCashOutCents(line.CreditAmount);
      entry.batches.add(String(line.JournalBatchNumber));
      generated.set(id, entry);
    }

    const summary: any[] = [];
    for (const [id, expected] of source) {
      const actual = generated.get(id);
      summary.push({
        id,
        sourceRows: expected.n,
        generatedLines: actual?.n ?? 0,
        sourceDebitCents: expected.dr,
        sourceCreditCents: expected.cr,
        generatedDebitCents: actual?.dr ?? 0,
        generatedCreditCents: actual?.cr ?? 0,
      });
      expect(actual?.n).toBe(expected.n);
      expect(actual?.dr).toBe(expected.dr);
      expect(actual?.cr).toBe(expected.cr);
      expect(expected.dr).toBe(expected.cr);
      expect(actual?.batches.size).toBe(1);
    }
    expect(generated.size).toBe(source.size);

    // ---- posting stage --------------------------------------------------
    const handler: any = new PostCashBatchToDFOHandler(
      {} as any,
      {} as any,
      new CashJournalRoutingService(),
    );
    const byJournal = new Map<string, any[]>();
    for (const line of formatted) {
      const key = String(line.JournalBatchNumber);
      byJournal.set(key, [...(byJournal.get(key) ?? []), { data: line }]);
    }
    const journals = handler.mapToD365FOCashJournalRequests(
      byJournal,
      'm-p',
      'out',
      'Freight',
    );

    const service: any = Object.create(CustomerPaymentJournalService.prototype);
    const seenLines = new Set<string>();
    let requestCount = 0;
    const requestsByUniqueId = new Map<string, number>();
    const integrity = {
      journalsVerified: 0,
      tamperingDetected: 0,
      ambiguousAfterRestart: 0,
    };
    const settlementTargets: unknown[] = [];
    const strategy: any = new CashJournalPostingStrategy(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    for (const [journalIndex, journal] of journals.entries()) {
      const pending = journal.lines.map((l: any) => ({
        lineNumber: l.LineNumber,
        sourceLineNumber: l.sourceLineNumber,
        groupInvoice: String(l.groupInvoice ?? '').trim(),
        body: { ...l.customLineApiBody },
      }));
      const splitKeys = service.planCashOutInvoiceSplits(journal.lines, true);
      const requests: any[][] = service.groupCashOutPendingLinesByUniqueId(
        pending,
        true,
        splitKeys,
      );
      for (const request of requests) {
        requestCount++;
        const id = String(request[0].body.PAYMENTID);
        requestsByUniqueId.set(id, (requestsByUniqueId.get(id) ?? 0) + 1);
        // Source order is preserved inside every request.
        request.forEach((p, i) => {
          if (i > 0)
            expect(p.lineNumber).toBeGreaterThan(request[i - 1].lineNumber);
          const key = `${journalIndex}:${p.lineNumber}`;
          expect(seenLines.has(key)).toBe(false);
          seenLines.add(key);
        });
        // The request never leaves an unbalanced voucher in D365 ...
        const vouchers = simulateCashOutVouchers(
          request.map((p) => ({
            offsetless: !String(p.body.OffsetAccountTypeStr ?? '').trim(),
            debitCents: toCashOutCents(p.body.debitAmount),
            creditCents: toCashOutCents(p.body.creditAmount),
          })),
        );
        expect({ id, open: vouchers.openLines }).toEqual({ id, open: 0 });
        // ... and the guard that runs before sending accepts it.
        expect(() =>
          service.assertCashOutRequestBalanced(`J${journalIndex}`, request),
        ).not.toThrow();
      }

      // ---- simulated D365 commit, read-back and recovery -----------------
      const planned = journal.lines.map((l: any) =>
        toPlannedJournalLine(Number(l.LineNumber), l.customLineApiBody),
      );
      const committedByRequest: ActualJournalLine[][] = [];
      let d365Line = 0;
      let voucherNo = 0;
      for (const request of requests) {
        // X++ starts a fresh voucher state per request and closes a voucher
        // once debit equals credit (one-cent tolerance).
        const committed: ActualJournalLine[] = [];
        let voucher = ++voucherNo;
        let debit = 0;
        let credit = 0;
        for (const pendingLine of request) {
          const line = toPlannedJournalLine(
            pendingLine.lineNumber,
            pendingLine.body,
          );
          committed.push({
            lineNumber: ++d365Line,
            paymentId: line.paymentId,
            accountType:
              line.accountType === 'Vendor' ? 'Vend' : line.accountType,
            account: line.account,
            currency: line.currency,
            debitCents: line.debitCents,
            creditCents: line.creditCents,
            voucher: `V${voucher}`,
          });
          debit += line.debitCents;
          credit += line.creditCents;
          if (Math.abs(debit - credit) <= 1) {
            debit = 0;
            credit = 0;
            voucher = ++voucherNo;
          }
        }
        committedByRequest.push(committed);
      }
      const actualJournal = committedByRequest.flat();
      const verify = (actual: ActualJournalLine[]) =>
        verifyJournalContent({
          journalNumber: `J${journalIndex}`,
          planned,
          actual,
          checkVoucherBalance: planned.every((l) => l.offsetless),
        });

      // The journal D365 would hold is verified without a single error ...
      expect(verify(actualJournal)).toEqual([]);
      integrity.journalsVerified++;
      // ... and any tampering with it is detected.
      expect(verify(actualJournal.slice(1)).length).toBeGreaterThan(0);
      expect(
        verify(
          actualJournal.map((l, i) =>
            i === 0 ? { ...l, debitCents: l.debitCents + 1 } : l,
          ),
        ).length,
      ).toBeGreaterThan(0);
      integrity.tamperingDetected++;

      // Restart after half of the requests were committed: recovery finds the
      // committed lines by content (D365 numbers differ from the plan) and
      // fails closed on anything it cannot attribute.
      const half = Math.floor(requests.length / 2);
      const firstHalf = new Set(
        requests.slice(0, half).flatMap((r) => r.map((x) => x.lineNumber)),
      );
      const reconciliation = reconcileExistingJournalLines(
        planned,
        committedByRequest.slice(0, half).flat(),
      );
      const ambiguous = new Set(
        reconciliation.ambiguousIdentities.flatMap((a) => a.plannedLineNumbers),
      );
      for (const n of reconciliation.existingPlannedLineNumbers) {
        expect(firstHalf.has(n)).toBe(true);
      }
      for (const n of firstHalf) {
        expect(
          reconciliation.existingPlannedLineNumbers.has(n) || ambiguous.has(n),
        ).toBe(true);
      }
      integrity.ambiguousAfterRestart +=
        reconciliation.ambiguousIdentities.length;

      // Settlement targets that the marking step receives for this journal.
      const prepared = strategy.prepareCashPostingLines(
        journal.route,
        journal.lines,
        true,
      );
      settlementTargets.push(
        ...prepared.deferredSettlements.map((t: unknown) => t),
      );
    }
    expect(seenLines.size).toBe(formatted.length);

    // The 732-line group of the reference workbook stays whole.
    if (source.has('534844')) {
      expect(source.get('534844')?.n).toBe(732);
      expect(requestsByUniqueId.get('534844')).toBe(1);
    }

    if (process.env.CUST_OUT) {
      fs.writeFileSync(
        process.env.CUST_OUT,
        JSON.stringify(
          {
            sourceRows: rows.length,
            uniqueIds: source.size,
            generatedLines: formatted.length,
            journals: journals.length,
            requests: requestCount,
            integrity,
            settlementTargets: {
              count: settlementTargets.length,
              sha1: crypto
                .createHash('sha1')
                .update(JSON.stringify(settlementTargets))
                .digest('hex'),
            },
            splitUniqueIds: [...requestsByUniqueId.values()].filter(
              (n) => n > 1,
            ).length,
            summary,
          },
          null,
          1,
        ),
      );
    }
  }, 300000);
});
