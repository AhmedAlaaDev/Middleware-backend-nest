import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';

const DEFAULT_INPUT = 'src/analysis/cash-out-use-cases.json';
const DEFAULT_OUTPUT = 'src/analysis/cash-out-use-cases-report.html';

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function esc(v: unknown): string {
  const s = String(v ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(text: string, cls: string): string {
  return `<span class="badge badge-${cls}">${esc(text)}</span>`;
}

function riskBadges(riskFlags: Record<string, boolean>): string {
  const parts: string[] = [];
  if (riskFlags.hasMixedCurrencies)
    parts.push(badge('Mixed Currency', 'currency'));
  if (riskFlags.hasSettlementLines)
    parts.push(badge('Settlement', 'settlement'));
  if (riskFlags.hasMultipleVendors) parts.push(badge('Multi Vendor', 'multi'));
  if (riskFlags.hasLedgerOffset) parts.push(badge('Ledger Offset', 'ledger'));
  if (riskFlags.cartesianProductRiskInCurrentProcessor) {
    parts.push(badge('Cartesian Risk', 'danger'));
  }
  if (parts.length === 0) return '<span class="no-risk">None</span>';
  return parts.join(' ');
}

function countTable(title: string, counts: Record<string, number>): string {
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([key, count]) =>
        `<tr><td>${esc(key)}</td><td class="num">${fmt(count)}</td></tr>`,
    )
    .join('');
  return `
    <table class="summary-table">
      <thead><tr><th>${esc(title)}</th><th class="num">Count</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function classificationPill(key: string, value: string): string {
  return `<span class="pill"><span class="pill-key">${esc(key)}</span><span class="pill-val">${esc(value)}</span></span>`;
}

type SourceRow = {
  lineNumber: number;
  safeTransaction: 'Out';
  safeType: string;
  voucherType: string;
  accountType: string;
  accountDisplayValue: string;
  mainAccount: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  currencyCode: string;
  exchangeRate: number;
  invoice: string;
  paymentReference: string;
  isVendorLine: boolean;
  isOffsetLine: boolean;
  isLedgerLine: boolean;
  isSettlementLine: boolean;
  isRoutedLine: boolean;
  routedBucket: 'custodySettlement' | 'vendorPayment' | 'custodyIssue' | null;
};

type Example = {
  uniqueId: number;
  sourceRows: SourceRow[];
  totals: { debit: number; credit: number };
  truncated: boolean;
  totalRowsInGroup: number;
};

type Variant = {
  variantId: string;
  frequency: number;
  details: {
    exactLineCount: number;
    accountTypeComposition: Record<string, number>;
    vendorLines: number;
    offsetLines: number;
    ledgerLines: number;
    settlementLines: number;
    offsetAccountTypes: string[];
    ledgerMainAccounts: string[];
    currencies: string[];
    isBalancedInSource: boolean;
  };
  examples: Example[];
};

type MainUseCase = {
  useCaseId: string;
  title: string;
  frequency: number;
  variantCount: number;
  businessClassification: Record<string, string>;
  detailedClassification: Record<string, string>;
  riskFlags: Record<string, boolean>;
  variants: Variant[];
  currentProcessorBehavior: {
    accountLineSelector: string;
    offsetLineSelector: string;
    caseUsed: string;
    expectedGeneratedLineCountFormula: string;
    hasCartesianProductRisk: boolean;
    notes: string[];
  };
};

type RoutedBucket = {
  rows: number;
  uniqueIds: number;
  examples: Example[];
};

type Summary = {
  sourceFile: string;
  generatedAt: string;
  totalRows: number;
  totalCashOutRows: number;
  totalUniqueIds: number;
  totalMainUseCases: number;
  totalVariants: number;
  countsBySafeType: Record<string, number>;
  countsByVoucherType: Record<string, number>;
  countsByMappingBucket: Record<string, number>;
  countsByBusinessOffsetMultiplicity: Record<string, number>;
  countsByBusinessOffsetCategory: Record<string, number>;
  countsByBusinessCurrencyPattern: Record<string, number>;
  countsByRiskFlag: Record<string, number>;
};

type Report = {
  summary: Summary;
  routedBuckets: {
    custodySettlement: RoutedBucket;
    vendorPayment: RoutedBucket;
    custodyIssue: RoutedBucket;
  };
  mainUseCases: MainUseCase[];
};

function renderSourceRowsTable(example: Example): string {
  const body = example.sourceRows
    .map((row) => {
      const rowClass = row.isSettlementLine ? 'settlement-row' : '';
      return `<tr class="${rowClass}">
        <td class="num">${row.lineNumber}</td>
        <td>${esc(row.safeType)}</td>
        <td>${esc(row.accountType)}</td>
        <td class="mono">${esc(row.accountDisplayValue)}</td>
        <td class="mono">${esc(row.mainAccount)}</td>
        <td class="num">${row.debitAmount > 0 ? fmt(row.debitAmount) : ''}</td>
        <td class="num">${row.creditAmount > 0 ? fmt(row.creditAmount) : ''}</td>
        <td>${esc(row.currencyCode)}</td>
      </tr>`;
    })
    .join('');

  const truncated = example.truncated
    ? `<tr><td colspan="8" class="muted">⋯ first ${example.sourceRows.length} of ${example.totalRowsInGroup} rows shown</td></tr>`
    : '';

  return `
    <table class="source-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Safe Type</th>
          <th>Acct Type</th>
          <th>Account Display Value</th>
          <th>Main Account</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
          <th>Ccy</th>
        </tr>
      </thead>
      <tbody>
        ${body}
        ${truncated}
        <tr class="totals-row">
          <td colspan="4" class="num"><strong>Totals</strong></td>
          <td class="num"><strong>${fmt(example.totals.debit)}</strong></td>
          <td class="num"><strong>${fmt(example.totals.credit)}</strong></td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>`;
}

function renderVariant(v: Variant): string {
  const d = v.details;
  const details = [
    ['Lines', String(d.exactLineCount)],
    [
      'Composition',
      Object.entries(d.accountTypeComposition)
        .filter(([, c]) => c > 0)
        .map(([k, c]) => `${k}:${c}`)
        .join(', '),
    ],
    ['Vendor lines', String(d.vendorLines)],
    ['Offset lines', String(d.offsetLines)],
    ['Ledger lines', String(d.ledgerLines)],
    ['Settlement lines', String(d.settlementLines)],
    ['Offset types', d.offsetAccountTypes.join(', ') || '—'],
    ['Ledger accts', d.ledgerMainAccounts.join(', ') || '—'],
    ['Currencies', d.currencies.join(', ') || '—'],
    ['Balanced', d.isBalancedInSource ? 'Yes' : 'No'],
  ];
  const detailPills = details
    .map(([k, val]) => classificationPill(k, val))
    .join('');

  const ex = v.examples[0];
  const exampleBlock = ex
    ? `
      <div class="example-uid">UniqueId: <strong>${ex.uniqueId}</strong></div>
      ${renderSourceRowsTable(ex)}
    `
    : '';

  return `
    <div class="variant">
      <div class="variant-head">
        <span class="variant-id">${esc(v.variantId)}</span>
        <span class="variant-freq">${fmt(v.frequency)}x</span>
      </div>
      <div class="pill-strip">${detailPills}</div>
      ${exampleBlock}
    </div>`;
}

function renderReviewArea(): string {
  return `
    <div class="review-area">
      <div class="review-title">Accounting Review</div>
      <div class="ruled"></div>
      <div class="ruled"></div>
      <div class="ruled"></div>
      <div class="ruled"></div>
      <div class="ruled"></div>
      <div class="ruled"></div>
      <div class="ruled"></div>
    </div>`;
}

function renderUseCase(uc: MainUseCase): string {
  const business = Object.entries(uc.businessClassification)
    .map(([k, v]) => classificationPill(k, String(v)))
    .join('');
  const detailed = Object.entries(uc.detailedClassification)
    .map(([k, v]) => classificationPill(k, String(v)))
    .join('');
  const cpb = uc.currentProcessorBehavior;
  const cpbPills = [
    ['Account line selector', cpb.accountLineSelector],
    ['Offset line selector', cpb.offsetLineSelector],
    ['Case used', cpb.caseUsed],
    ['Formula', cpb.expectedGeneratedLineCountFormula],
    ['Cartesian risk', cpb.hasCartesianProductRisk ? 'YES' : 'No'],
  ]
    .map(([k, v]) => classificationPill(k, v))
    .join('');

  const maxVariants =
    uc.riskFlags.hasSettlementLines ||
    uc.riskFlags.hasMixedCurrencies ||
    uc.riskFlags.cartesianProductRiskInCurrentProcessor
      ? 4
      : 2;

  const variants = uc.variants
    .slice(0, maxVariants)
    .map(renderVariant)
    .join('');

  return `
    <section class="use-case page-break" id="${esc(uc.useCaseId)}">
      <div class="use-case-head">
        <div class="id">${esc(uc.useCaseId)}</div>
        <div class="title">${esc(uc.title)}</div>
        <div class="meta">Frequency: ${fmt(uc.frequency)} | Variants: ${fmt(uc.variantCount)}</div>
        <div>${riskBadges(uc.riskFlags)}</div>
      </div>
      <div class="pill-strip">${business}</div>
      <div class="pill-strip muted-strip">${detailed}</div>
      <div class="pill-strip">${cpbPills}</div>
      <h4>Variants</h4>
      ${variants}
      ${renderReviewArea()}
    </section>`;
}

function buildCoverPage(report: Report): string {
  const { summary, routedBuckets } = report;
  const generated = new Date(summary.generatedAt).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return `
    <section class="cover">
      <h1>Cash-Out Mapping Use Cases Review</h1>
      <table class="meta-table">
        <tr><td>Source File</td><td>${esc(summary.sourceFile)}</td></tr>
        <tr><td>Generated</td><td>${esc(generated)}</td></tr>
        <tr><td>Total Rows</td><td>${fmt(summary.totalRows)}</td></tr>
        <tr><td>Total Cash-Out Rows</td><td>${fmt(summary.totalCashOutRows)}</td></tr>
        <tr><td>Total Unique IDs</td><td>${fmt(summary.totalUniqueIds)}</td></tr>
        <tr><td>Total Main Use Cases</td><td>${fmt(summary.totalMainUseCases)}</td></tr>
        <tr><td>Total Variants</td><td>${fmt(summary.totalVariants)}</td></tr>
      </table>

      <div class="grid">
        ${countTable('By Safe Type', summary.countsBySafeType)}
        ${countTable('By Voucher Type', summary.countsByVoucherType)}
        ${countTable('By Mapping Bucket', summary.countsByMappingBucket)}
        ${countTable('By Offset Category', summary.countsByBusinessOffsetCategory)}
        ${countTable('By Currency Pattern', summary.countsByBusinessCurrencyPattern)}
      </div>

      <h3>Routed Buckets Summary</h3>
      <table class="summary-table">
        <thead><tr><th>Bucket</th><th class="num">Rows</th><th class="num">Unique IDs</th></tr></thead>
        <tbody>
          <tr><td>Custody Settlement</td><td class="num">${fmt(routedBuckets.custodySettlement.rows)}</td><td class="num">${fmt(routedBuckets.custodySettlement.uniqueIds)}</td></tr>
          <tr><td>Vendor Payment</td><td class="num">${fmt(routedBuckets.vendorPayment.rows)}</td><td class="num">${fmt(routedBuckets.vendorPayment.uniqueIds)}</td></tr>
          <tr><td>Custody Issue</td><td class="num">${fmt(routedBuckets.custodyIssue.rows)}</td><td class="num">${fmt(routedBuckets.custodyIssue.uniqueIds)}</td></tr>
        </tbody>
      </table>
    </section>`;
}

function buildCss(): string {
  return `
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 9pt; color: #111; }
    @media print {
      @page { size: A4 portrait; margin: 10mm; }
      .page-break { page-break-before: always; }
    }
    @media screen {
      body { background: #f0f0f0; padding: 20px; }
      section { background: #fff; margin: 0 auto 20px; max-width: 210mm; padding: 20px; box-shadow: 0 1px 8px rgba(0,0,0,.12); }
    }

    h1 { margin: 0 0 12px; font-size: 18pt; }
    h3 { margin: 14px 0 8px; font-size: 11pt; }
    h4 { margin: 10px 0 6px; font-size: 9pt; text-transform: uppercase; border-bottom: 1px solid #ddd; }
    .num { text-align: right; white-space: nowrap; }
    .mono { font-family: Consolas, monospace; }
    .muted { color: #666; font-style: italic; text-align: center; }

    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .meta-table td { border-bottom: 1px solid #ddd; padding: 3px 6px; }
    .meta-table td:first-child { width: 180px; font-weight: 700; }

    .grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .summary-table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
    .summary-table th, .summary-table td { border: 1px solid #ccc; padding: 3px 6px; }
    .summary-table th { background: #f1f1f1; text-align: left; }
    .grid .summary-table { flex: 1; min-width: 170px; }

    .use-case-head { border-left: 4px solid #222; padding-left: 10px; margin-bottom: 8px; }
    .use-case-head .id { font-weight: 700; color: #555; font-size: 7pt; letter-spacing: .1em; }
    .use-case-head .title { font-size: 12pt; font-weight: 700; margin: 2px 0; }
    .use-case-head .meta { font-size: 8pt; color: #555; margin-bottom: 4px; }

    .pill-strip { display: flex; flex-wrap: wrap; gap: 4px 8px; border: 1px solid #e2e2e2; background: #f9f9f9; padding: 5px 7px; border-radius: 3px; margin-bottom: 6px; }
    .muted-strip { opacity: .8; }
    .pill { display: inline-flex; gap: 4px; font-size: 7pt; }
    .pill-key { color: #666; font-weight: 700; }
    .pill-val { color: #111; }

    .variant { border: 1px solid #ddd; border-radius: 3px; padding: 6px; margin-bottom: 8px; }
    .variant-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .variant-id { font-family: Consolas, monospace; font-weight: 700; font-size: 8pt; }
    .variant-freq { background: #efefef; border-radius: 10px; padding: 1px 7px; font-size: 7pt; }
    .example-uid { background: #111; color: #fff; padding: 4px 8px; border-radius: 3px 3px 0 0; font-size: 8pt; margin-top: 5px; }

    .source-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7pt; border: 1px solid #999; }
    .source-table th { background: #333; color: #fff; border-right: 1px solid #666; padding: 2px 4px; text-align: left; }
    .source-table td { border-right: 1px solid #eee; border-bottom: 1px solid #ddd; padding: 2px 4px; vertical-align: top; word-break: break-all; overflow-wrap: anywhere; }
    .source-table tr:nth-child(even) td { background: #f7f7f7; }
    .source-table .settlement-row td { background: #d8d8d8 !important; }
    .totals-row td { border-top: 2px solid #555; background: #ececec; }

    .review-area { border: 1px solid #bbb; border-radius: 3px; margin-top: 8px; padding: 6px 8px; }
    .review-title { font-weight: 700; font-size: 8pt; margin-bottom: 4px; text-align: center; }
    .ruled { border-bottom: 1px solid #bbb; height: 18px; }

    .badge { display: inline-block; border: 1px solid #555; padding: 1px 4px; border-radius: 2px; font-size: 6.5pt; font-weight: 700; background: #fff; margin-right: 3px; white-space: nowrap; }
    .badge-settlement { text-decoration: underline; font-style: italic; }
    .badge-danger { font-style: italic; }
    .no-risk { color: #999; font-style: italic; }
  `;
}

function buildHtml(report: Report): string {
  const sections = report.mainUseCases.map(renderUseCase).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cash-Out Mapping Use Cases Review</title>
  <style>${buildCss()}</style>
</head>
<body>
  ${buildCoverPage(report)}
  ${sections}
</body>
</html>`;
}

async function main(): Promise<void> {
  const inputArg = getArgValue('--input') || DEFAULT_INPUT;
  const outputArg = getArgValue('--output') || DEFAULT_OUTPUT;

  const inputPath = resolve(process.cwd(), inputArg);
  const outputPath = resolve(process.cwd(), outputArg);

  const raw = await fs.readFile(inputPath, 'utf8');
  const report: Report = JSON.parse(raw) as Report;

  const html = buildHtml(report);
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');

  console.info(`use cases: ${report.mainUseCases.length}`);
  console.info(`variants:  ${report.summary.totalVariants}`);
  console.info(`written:   ${outputArg}`);
}

main().catch((error) => {
  console.error('Failed to render Cash-Out report.');
  console.error(error);
  process.exitCode = 1;
});
