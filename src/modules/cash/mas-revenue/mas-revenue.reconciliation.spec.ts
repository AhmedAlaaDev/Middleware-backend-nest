import { readFileSync, writeFileSync } from 'fs';

import { normalizeMasRevenueRows } from './mas-revenue-normalizer';
import { parseMasRevenueWorkbook } from './mas-revenue-workbook.parser';

/**
 * Reconciles a real source workbook. Opt-in so financial data never enters the
 * repository. Run with:
 *   MAS_REVENUE_SAMPLE_XLSX=<path> MAS_REVENUE_SAMPLE_CURRENCY=<ISO code> \
 *     [MAS_REVENUE_REPORT_JSON=<path>] pnpm run test -- mas-revenue.reconciliation
 * The currency must be supplied; it is not inferred from the workbook or company.
 */
const samplePath = process.env.MAS_REVENUE_SAMPLE_XLSX;
const sampleCurrency = process.env.MAS_REVENUE_SAMPLE_CURRENCY;
const describeIfSample =
  samplePath && sampleCurrency ? describe : describe.skip;

describeIfSample('MAS Revenue reconciliation (real workbook)', () => {
  it('accounts for every scanned row and reports per-currency totals', async () => {
    const buffer = readFileSync(samplePath as string);
    const parsed = await parseMasRevenueWorkbook(buffer);
    const result = normalizeMasRevenueRows(parsed, {
      transactionCurrency: sampleCurrency as string,
    });

    const dataRows = parsed.scannedRowCount - parsed.headerRow;
    const { blank, zeroPlaceholder, cancelled } = result.nonTransactionRows;
    expect(
      blank +
        zeroPlaceholder +
        cancelled +
        result.accounting.transactionRowsRead,
    ).toBe(dataRows);
    expect(result.receipts.length + result.accounting.rejected).toBe(
      result.accounting.transactionRowsRead,
    );

    const totals = result.receipts.reduce(
      (acc, r) => ({
        value: acc.value + r.valueMinor,
        vat: acc.vat + r.vatMinor,
        total: acc.total + r.totalMinor,
      }),
      { value: 0, vat: 0, total: 0 },
    );

    const report = {
      sourceSheet: parsed.sourceSheet,
      headerRow: parsed.headerRow,
      scannedDataRows: dataRows,
      nonTransactionRows: result.nonTransactionRows,
      transactionRowsRead: result.accounting.transactionRowsRead,
      accepted: result.accounting.accepted,
      rejected: result.accounting.rejected,
      currency: (sampleCurrency as string).toUpperCase(),
      totalsMinor: totals,
      totalsMajor: {
        value: totals.value / 100,
        vat: totals.vat / 100,
        total: totals.total / 100,
      },
      receipts: result.receipts.map((r) => ({
        sourceRow: r.sourceRow,
        invoiceNumber: r.invoiceNumber,
        transactionDate: r.transactionDate,
        totalMajor: r.totalMinor / 100,
        cashAccountDisplayName: r.cashAccountDisplayName,
        customerName: r.customerName,
        billOfLading: r.billOfLading,
        containerNumber: r.containerNumber,
      })),
      issues: result.issues,
    };

    const reportPath = process.env.MAS_REVENUE_REPORT_JSON;
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    }

    expect(report.rejected).toBe(0);
  });
});
