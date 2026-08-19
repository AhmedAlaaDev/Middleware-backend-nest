import { readFile } from 'fs/promises';
import { join } from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

// ---------------------------------------------------------------------------
// Shared fixture loader — runs once before all scenarios
// ---------------------------------------------------------------------------

async function loadFixture() {
  const adapter = new ExcelJsAdapter();
  const buffer = await readFile(
    join(
      process.cwd(),
      'src/excel-sources/Cash/cash_out_enhancement/IN-JAN-Custody Settlement.xlsx',
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
// Helper — classify rows by UniqueId and detect withholding groups
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

// ---------------------------------------------------------------------------

describe('Custody Settlement MarkedLines workbook regression', () => {
  // -------------------------------------------------------------------------
  // Scenario 1 – Preservation: non-withholding groups keep populated MarkedLines
  // -------------------------------------------------------------------------
  describe('Scenario 1 — vendor lines in groups WITHOUT a 223304 withholding ledger line', () => {
    it('formats IN-JAN-Custody Settlement vendor lines and maps MarkedLines into the Cash Out API body', async () => {
      const rows = await loadFixture();
      const processor = await buildProcessor(rows);

      const result = (await processor.formatAndEnrichAsync(
        rows as any,
        'm-p',
      )) as any[];

      // Identify UniqueIds (UNIQUEID field on raw rows) that contain a 223304 line
      const withholdingUniqueIds = new Set<string>(
        (rows as any[])
          .filter((r) => isWithholdingLedgerRow(r))
          .map((r) => String(r.UNIQUEID ?? r.UniqueId ?? '').trim()),
      );

      const vendors = result.filter(
        (line) => String(line.AccountType).toLowerCase() === 'vend',
      );
      expect(vendors.length).toBeGreaterThan(0);

      // Non-withholding-group vendor lines must still carry populated MarkedLines
      const nonWithholdingVendors = vendors.filter(
        (line) => !withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
      );

      if (nonWithholdingVendors.length > 0) {
        expect(
          nonWithholdingVendors.every((line) => (line.MarkedLines?.length ?? 0) > 0),
        ).toBe(true);

        const custodyVendors = nonWithholdingVendors.filter(
          (line) => String(line.VendorGroup).toLowerCase() === 'custody',
        );
        const standardVendors = nonWithholdingVendors.filter(
          (line) => String(line.VendorGroup).toLowerCase() !== 'custody',
        );

        // Scenario 1a – Custody vendor: DocumentNumber + OperationNumber, no InvoiceNumber
        if (custodyVendors.length > 0) {
          expect(
            custodyVendors.every(
              (line) =>
                line.MarkedLines[0].InvoiceNumber === '' &&
                Boolean(line.MarkedLines[0].DocumentNumber) &&
                Boolean(line.MarkedLines[0].OperationNumber),
            ),
          ).toBe(true);
        }

        // Scenario 1b – Standard vendor: InvoiceNumber + OperationNumber, no DocumentNumber
        if (standardVendors.length > 0) {
          expect(
            standardVendors.every(
              (line) =>
                line.MarkedLines[0].DocumentNumber === '' &&
                Boolean(line.MarkedLines[0].OperationNumber),
            ),
          ).toBe(true);
        }
      }

      // Full pipeline: mapLines must also produce non-empty MarkedLines for
      // non-withholding-group vendor lines
      const handler = new PostCashBatchToDFOHandler(
        {} as any,
        {} as any,
        new CashJournalRoutingService(),
      );
      const route = new CashJournalRoutingService().resolve({
        safeType: 'Custody Settlement',
        targetProcessor: 'Freight',
      });

      const sampleNonWht = nonWithholdingVendors.slice(0, 10);
      if (sampleNonWht.length > 0) {
        const mapped = (handler as any).mapLines(
          sampleNonWht.map((line, index) => ({
            id: String(index),
            data: line,
          })),
          'm-p',
          'out',
          route,
        );
        expect(
          mapped.every(
            (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) > 0,
          ),
        ).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2 – Withholding suppression: groups WITH a 223304 line must
  // produce empty MarkedLines and "- unmarked" in the description.
  //
  // On UNFIXED code this test FAILS (vendor lines still carry MarkedLines).
  // After the fix this test PASSES — confirming the bug is resolved.
  // -------------------------------------------------------------------------
  describe('Scenario 2 — vendor lines in groups WITH a 223304 withholding ledger line', () => {
    it('suppresses MarkedLines and appends "- unmarked" for vendor lines whose UniqueId group contains a 223304 ledger line', async () => {
      const rows = await loadFixture();
      const processor = await buildProcessor(rows);

      const result = (await processor.formatAndEnrichAsync(
        rows as any,
        'm-p',
      )) as any[];

      // Identify UniqueIds that contain at least one 223304 withholding row
      const withholdingUniqueIds = new Set<string>(
        (rows as any[])
          .filter((r) => isWithholdingLedgerRow(r))
          .map((r) => String(r.UNIQUEID ?? r.UniqueId ?? '').trim()),
      );

      // Skip this assertion block if the fixture has no withholding groups
      // (makes the test portable across fixtures without 223304 rows)
      if (withholdingUniqueIds.size === 0) {
        // No withholding groups in fixture — nothing to assert
        return;
      }

      const vendors = result.filter(
        (line) => String(line.AccountType).toLowerCase() === 'vend',
      );

      const withholdingGroupVendors = vendors.filter((line) =>
        withholdingUniqueIds.has(String(line.PaymentId ?? '').trim()),
      );

      // There must be at least one vendor line in a withholding group
      expect(withholdingGroupVendors.length).toBeGreaterThan(0);

      // Bug Condition → Expected Behavior:
      // Every vendor line in a withholding group must have empty MarkedLines
      expect(
        withholdingGroupVendors.every((line) => line.MarkedLines.length === 0),
      ).toBe(true);

      // And the description must include "- unmarked"
      expect(
        withholdingGroupVendors.every((line) =>
          String(line.Description ?? '')
            .toLowerCase()
            .includes('unmarked'),
        ),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3 – Integration: full mapLines pipeline respects suppression
  // -------------------------------------------------------------------------
  describe('Scenario 3 — full mapLines pipeline with withholding suppression', () => {
    it('produces MarkedLines=[] via PostCashBatchToDFOHandler for withholding-group vendor lines and MarkedLines.length>0 for non-withholding-group vendor lines', async () => {
      const rows = await loadFixture();
      const processor = await buildProcessor(rows);

      const result = (await processor.formatAndEnrichAsync(
        rows as any,
        'm-p',
      )) as any[];

      const withholdingUniqueIds = new Set<string>(
        (rows as any[])
          .filter((r) => isWithholdingLedgerRow(r))
          .map((r) => String(r.UNIQUEID ?? r.UniqueId ?? '').trim()),
      );

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
        vendors.map((line, index) => ({
          id: String(index),
          data: line,
        })),
        'm-p',
        'out',
        route,
      );

      // Rebuild a lookup: mapped index → original vendor line's PaymentId
      const vendorPaymentIds = vendors.map((line) =>
        String(line.PaymentId ?? '').trim(),
      );

      if (withholdingUniqueIds.size > 0) {
        // Withholding-group vendor lines: MarkedLines must be empty
        const whtMapped = mapped.filter((_: any, i: number) =>
          withholdingUniqueIds.has(vendorPaymentIds[i]),
        );
        if (whtMapped.length > 0) {
          expect(
            whtMapped.every(
              (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) === 0,
            ),
          ).toBe(true);
        }
      }

      // Non-withholding-group vendor lines: MarkedLines must be populated
      const nonWhtMapped = mapped.filter((_: any, i: number) =>
        !withholdingUniqueIds.has(vendorPaymentIds[i]),
      );
      if (nonWhtMapped.length > 0) {
        expect(
          nonWhtMapped.every(
            (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) > 0,
          ),
        ).toBe(true);
      }
    });
  });
});
