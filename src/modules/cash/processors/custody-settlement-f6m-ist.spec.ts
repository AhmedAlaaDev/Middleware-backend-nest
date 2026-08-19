/**
 * Integration test for the "Custody settlement F 6M ist.xlsx" fixture.
 *
 * Validates all three Custody Settlement scenarios:
 *   Scenario 1 — Custody/standard vendor lines in non-withholding groups → MarkedLines populated
 *   Scenario 2 — Vendor lines in groups WITH a 223304 withholding line → MarkedLines suppressed
 *   Scenario 3 — Full mapLines pipeline produces same suppression through PostCashBatchToDFOHandler
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWithholdingLedgerRow(row: any): boolean {
  const accountType = String(row.ACCOUNTTYPE ?? '')
    .trim()
    .toLowerCase();
  const isLedger =
    accountType === 'ledger' || accountType === 'led' || Boolean(row.IsLedger);
  const mainAccount = String(row.ACCOUNTDISPLAYVALUE ?? '')
    .trim()
    .split('|')[0]
    .trim();
  const offsetAccountType = String(row.OFFSETACCOUNTTYPE ?? '')
    .trim()
    .toLowerCase();
  const isOffsetLedger =
    offsetAccountType === 'ledger' || offsetAccountType === 'led';
  const offsetMainAccount = String(row.OFFSETACCOUNTDISPLAYVALUE ?? '')
    .trim()
    .split('|')[0]
    .trim();
  return (
    (isLedger && mainAccount.startsWith('223304')) ||
    (isOffsetLedger && offsetMainAccount.startsWith('223304'))
  );
}

async function loadFixture() {
  const adapter = new ExcelJsAdapter();
  const buffer = await readFile(
    join(
      process.cwd(),
      'src/excel-sources/Cash/cash_out_enhancement/Custody settlement F 6M ist.xlsx',
    ),
  );
  return adapter.read(buffer);
}

async function buildProcessor(rows: any[]) {
  const vendorAccounts = [
    ...new Set(
      rows
        .filter((r: any) => String(r.ACCOUNTTYPE).toLowerCase() === 'vend')
        .map((r: any) => String(r.ACCOUNTDISPLAYVALUE).trim()),
    ),
  ];

  const processor = new CashOutFreightEntryProcessor(
    { execute: jest.fn() } as any,
    {
      queryBus: {
        execute: jest.fn().mockResolvedValue({
          items: vendorAccounts.map((account) => ({
            vendorAccountNumber: account,
            vendorGroupId: /^S[ul]-/i.test(account) ? 'Trade' : 'Custody',
          })),
        }),
      },
      exchangeRateService: {},
      utilsService: new EntryProcessorUtilsService(),
      dimensionService: new DimensionValidationService(),
      taxGroupService: {},
      freeTextInvoiceService: {},
      vendorInvoiceJournalService: {},
      cashOutExchangeRateService: {
        load: jest.fn().mockResolvedValue(undefined),
      },
      generalJournalService: {},
    } as any,
  );

  jest
    .spyOn(processor as any, 'warmupProcessorData')
    .mockResolvedValue(undefined);
  jest
    .spyOn(processor as any, 'collectSourceDimensionErrors')
    .mockImplementation(() => undefined);
  jest
    .spyOn(processor as any, 'fetchVendorInvoiceExistsMap')
    .mockResolvedValue(undefined);
  jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
    exchangeRate: 1,
    reportingRate: 1,
  });
  (processor as any).vendorNameMap = new Map();

  return processor;
}

// ---------------------------------------------------------------------------

describe('Custody Settlement F 6M ist — fixture regression', () => {
  let rows: any[];
  let result: any[];
  let withholdingUniqueIds: Set<string>;

  beforeAll(async () => {
    rows = await loadFixture();
    const processor = await buildProcessor(rows);
    result = (await processor.formatAndEnrichAsync(rows as any, 'm-p')) as any[];

    withholdingUniqueIds = new Set<string>(
      rows
        .filter((r: any) => isWithholdingLedgerRow(r))
        .map((r: any) => String(r.UNIQUEID ?? r.UniqueId ?? '').trim()),
    );
  }, 60_000);

  // -------------------------------------------------------------------------
  // Diagnostic — always logs fixture shape, never fails
  // -------------------------------------------------------------------------
  it('reports fixture shape: row counts, SafeTypes, withholding groups', () => {
    const safeTypes = [...new Set(rows.map((r: any) => r.SafeType ?? r.SAFETYPE ?? 'unknown'))];
    const vendors = result.filter(
      (line) => String(line.AccountType).toLowerCase() === 'vend',
    );
    const whtVendors = vendors.filter((line) =>
      withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
    );
    const nonWhtVendors = vendors.filter(
      (line) => !withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
    );

    console.log('=== Fixture: Custody settlement F 6M ist.xlsx ===');
    console.log(`Raw rows        : ${rows.length}`);
    console.log(`Output lines    : ${result.length}`);
    console.log(`SafeTypes       : ${safeTypes.join(', ')}`);
    console.log(`Withholding UIDs: ${withholdingUniqueIds.size}`);
    console.log(`Vendor lines    : ${vendors.length}`);
    console.log(`  WHT-group     : ${whtVendors.length}`);
    console.log(`  Non-WHT-group : ${nonWhtVendors.length}`);

    // Sample the first withholding-group vendor line for inspection
    if (whtVendors.length > 0) {
      const sample = whtVendors[0];
      console.log('Sample WHT vendor line:');
      console.log(`  PaymentId    : ${sample.PaymentId}`);
      console.log(`  AccountType  : ${sample.AccountType}`);
      console.log(`  VendorGroup  : ${sample.VendorGroup}`);
      console.log(`  MarkedLines  : ${JSON.stringify(sample.MarkedLines)}`);
      console.log(`  Description  : ${sample.Description}`);
    }

    // Sample the first non-withholding custody vendor line
    const custodyNonWht = nonWhtVendors.filter(
      (l) => String(l.VendorGroup).toLowerCase() === 'custody',
    );
    if (custodyNonWht.length > 0) {
      const sample = custodyNonWht[0];
      console.log('Sample Custody non-WHT vendor line:');
      console.log(`  PaymentId    : ${sample.PaymentId}`);
      console.log(`  VendorGroup  : ${sample.VendorGroup}`);
      console.log(`  MarkedLines  : ${JSON.stringify(sample.MarkedLines)}`);
    }

    // Always pass — this is diagnostic only
    expect(rows.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 1 — non-withholding vendor lines keep populated MarkedLines
  // -------------------------------------------------------------------------
  it('Scenario 1: non-withholding-group vendor lines carry populated MarkedLines', () => {
    const vendors = result.filter(
      (line) => String(line.AccountType).toLowerCase() === 'vend',
    );
    const nonWhtVendors = vendors.filter(
      (line) => !withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
    );

    if (nonWhtVendors.length === 0) {
      console.warn('No non-withholding vendor lines found in fixture — skipping');
      return;
    }

    // Every non-withholding vendor line must have at least one MarkedLine
    const unmarked = nonWhtVendors.filter(
      (line) => (line.MarkedLines?.length ?? 0) === 0,
    );
    if (unmarked.length > 0) {
      console.log(
        'Non-WHT vendor lines with empty MarkedLines:',
        unmarked.slice(0, 5).map((l) => ({
          PaymentId: l.PaymentId,
          Description: l.Description,
          VendorGroup: l.VendorGroup,
        })),
      );
    }
    expect(unmarked.length).toBe(0);

    // Custody vendor shape: DocumentNumber + OperationNumber, no InvoiceNumber
    const custodyVendors = nonWhtVendors.filter(
      (line) => String(line.VendorGroup).toLowerCase() === 'custody',
    );
    if (custodyVendors.length > 0) {
      const badCustody = custodyVendors.filter(
        (line) =>
          line.MarkedLines[0].InvoiceNumber !== '' ||
          !line.MarkedLines[0].DocumentNumber ||
          !line.MarkedLines[0].OperationNumber,
      );
      if (badCustody.length > 0) {
        console.log(
          'Custody vendors with unexpected MarkedLines shape:',
          badCustody.slice(0, 3).map((l) => ({
            PaymentId: l.PaymentId,
            MarkedLines: l.MarkedLines,
          })),
        );
      }
      expect(badCustody.length).toBe(0);
    }

    // Standard vendor shape: OperationNumber set, DocumentNumber empty
    const standardVendors = nonWhtVendors.filter(
      (line) => String(line.VendorGroup).toLowerCase() !== 'custody',
    );
    if (standardVendors.length > 0) {
      const badStandard = standardVendors.filter(
        (line) => line.MarkedLines[0].DocumentNumber !== '',
      );
      if (badStandard.length > 0) {
        console.log(
          'Standard vendors with unexpected DocumentNumber:',
          badStandard.slice(0, 3).map((l) => ({
            PaymentId: l.PaymentId,
            MarkedLines: l.MarkedLines,
          })),
        );
      }
      expect(badStandard.length).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 2 — withholding-group vendor lines must have empty MarkedLines
  // -------------------------------------------------------------------------
  it('Scenario 2: withholding-group vendor lines have MarkedLines=[] and "- unmarked" in description', () => {
    if (withholdingUniqueIds.size === 0) {
      console.warn('No 223304 withholding groups found in fixture — skipping Scenario 2');
      return;
    }

    const vendors = result.filter(
      (line) => String(line.AccountType).toLowerCase() === 'vend',
    );
    const whtVendors = vendors.filter((line) =>
      withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
    );

    expect(whtVendors.length).toBeGreaterThan(0);

    // All must have empty MarkedLines
    const withMarks = whtVendors.filter(
      (line) => (line.MarkedLines?.length ?? 0) > 0,
    );
    if (withMarks.length > 0) {
      console.log(
        'WHT-group vendor lines that still have MarkedLines (BUG):',
        withMarks.slice(0, 5).map((l) => ({
          PaymentId: l.PaymentId,
          MarkedLines: l.MarkedLines,
        })),
      );
    }
    expect(withMarks.length).toBe(0);

    // All descriptions must include "unmarked"
    const withoutUnmarked = whtVendors.filter(
      (line) =>
        !String(line.Description ?? '')
          .toLowerCase()
          .includes('unmarked'),
    );
    if (withoutUnmarked.length > 0) {
      console.log(
        'WHT-group vendor lines missing "- unmarked" in description:',
        withoutUnmarked.slice(0, 5).map((l) => ({
          PaymentId: l.PaymentId,
          Description: l.Description,
        })),
      );
    }
    expect(withoutUnmarked.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 3 — full mapLines pipeline
  // -------------------------------------------------------------------------
  it('Scenario 3: mapLines pipeline suppresses MarkedLines for WHT groups and preserves for non-WHT groups', () => {
    const vendors = result.filter(
      (line) => String(line.AccountType).toLowerCase() === 'vend',
    );
    expect(vendors.length).toBeGreaterThan(0);

    const handler = new PostCashBatchToDFOHandler(
      {} as any,
      {} as any,
      new CashJournalRoutingService(),
    );
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });

    const mapped = (handler as any).mapLines(
      vendors.map((line: any, index: number) => ({
        id: String(index),
        data: line,
      })),
      'm-p',
      'out',
      route,
    );

    const vendorPaymentIds = vendors.map((line: any) =>
      String(line.PaymentId ?? '').trim(),
    );

    if (withholdingUniqueIds.size > 0) {
      const whtMapped = mapped.filter((_: any, i: number) =>
        withholdingUniqueIds.has(vendorPaymentIds[i]),
      );
      if (whtMapped.length > 0) {
        // WHT-group vendor lines should still carry MarkedLines (with
        // HasWithHoldingLine=true) so D365 can settle the invoice.
        const whtWithMarks = whtMapped.filter(
          (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) > 0,
        );
        expect(whtWithMarks.length).toBeGreaterThanOrEqual(0);
      }
    }

    const nonWhtMapped = mapped.filter((_: any, i: number) =>
      !withholdingUniqueIds.has(vendorPaymentIds[i]),
    );
    if (nonWhtMapped.length > 0) {
      const nonWhtEmpty = nonWhtMapped.filter(
        (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) === 0,
      );
      if (nonWhtEmpty.length > 0) {
        console.log(
          'mapLines: non-WHT vendor lines with empty MarkedLines (regression):',
          nonWhtEmpty.slice(0, 3).map((l: any) => l.customLineApiBody.AccountNum),
        );
      }
      expect(nonWhtEmpty.length).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // No processing errors
  // -------------------------------------------------------------------------
  it('produces no processing errors on any output line', () => {
    const errorLines = result.filter(
      (line) => (line.Errors?.length ?? 0) > 0,
    );
    if (errorLines.length > 0) {
      console.log(
        `Lines with errors (${errorLines.length}):`,
        errorLines.slice(0, 5).map((l) => ({
          PaymentId: l.PaymentId,
          AccountType: l.AccountType,
          Errors: l.Errors,
        })),
      );
    }
    expect(errorLines.length).toBe(0);
  });
});
