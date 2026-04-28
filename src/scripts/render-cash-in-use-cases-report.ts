import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';

const DEFAULT_INPUT = 'analysis/cash-in-use-cases.json';
const DEFAULT_OUTPUT = 'analysis/cash-in-use-cases-report.html';

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
  if (riskFlags.hasSettlementLines) parts.push(badge('FX421103', 'settlement'));
  if (riskFlags.hasMixedCurrencies)
    parts.push(badge('Mixed Currency', 'currency'));
  if (riskFlags.hasMultipleCustomerLines)
    parts.push(badge('Multi Customer Lines', 'multi'));
  if (riskFlags.hasMultipleCustomers)
    parts.push(badge('Multi Customers', 'multi'));
  if (riskFlags.hasMultipleInvoices)
    parts.push(badge('Multi Invoice', 'multi'));
  if (riskFlags.hasLedgerOffset) parts.push(badge('Ledger Offset', 'ledger'));
  if (riskFlags.hasNotesReceivable)
    parts.push(badge('Notes Receivable', 'notes'));
  if (riskFlags.cartesianProductRiskInCurrentProcessor)
    parts.push(badge('Cartesian Risk', 'danger'));
  if (parts.length === 0) return '<span class="no-risk">None</span>';
  return parts.join(' ');
}

function classificationPill(key: string, value: string): string {
  return `<span class="cl-pill"><span class="cl-key">${esc(key)}</span><span class="cl-val">${esc(value)}</span></span>`;
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

type SourceRow = {
  lineNumber: number;
  accountType: string;
  accountDisplayValue: string;
  mainAccount: string;
  debitAmount: number;
  creditAmount: number;
  currencyCode: string;
  invoice: string;
  isCustomerLine: boolean;
  isLedgerLine: boolean;
  isSettlementLine: boolean;
  isNotesReceivableLine: boolean;
  ledgerCategory: string;
};

type Example = {
  uniqueId: number;
  sourceRows: SourceRow[];
  totals: { debit: number; credit: number };
  truncated: boolean;
  totalRowsInGroup: number;
};

type VariantDetails = {
  exactLineCount: number;
  accountTypeComposition: Record<string, number>;
  customerLines: number;
  offsetLines: number;
  ledgerLines: number;
  settlementLines: number;
  notesReceivableLines: number;
  offsetAccountTypes: string[];
  ledgerMainAccounts: string[];
  notesReceivableMainAccounts: string[];
  currencies: string[];
  isBalancedInSource: boolean;
};

type Variant = {
  variantId: string;
  frequency: number;
  exampleUniqueIds: number[];
  details: VariantDetails;
  examples: Example[];
};

type ProcessorBehavior = {
  removesSettlementLinesBeforeMapping: boolean;
  lineCountAfterSettlementRemovalPattern: string;
  expectedGeneratedLineCountFormula: string;
  hasCartesianProductRisk: boolean;
  notes: string[];
};

type BusinessClassification = {
  safeType: string;
  voucherType: string;
  offsetMultiplicityPattern: string;
  offsetCategoryPattern: string;
  currencyPattern: string;
  settlementPattern: string;
  notesReceivablePattern: string;
  sourceBalancePattern: string;
  amountBehaviorPattern: string;
};

type MainUseCase = {
  useCaseId: string;
  title: string;
  frequency: number;
  variantCount: number;
  businessClassification: BusinessClassification;
  classification: Record<string, string>;
  riskFlags: Record<string, boolean>;
  variants: Variant[];
  currentProcessorBehavior: ProcessorBehavior;
  businessReview: Record<string, string>;
};

type Summary = {
  sourceFile: string;
  generatedAt: string;
  totalRows: number;
  totalCashInRows: number;
  totalUniqueIds: number;
  totalMainUseCases: number;
  totalVariants: number;
  includedSafeTypes: string[];
  excludedSafeTypes: string[];
  countsBySafeType: Record<string, number>;
  countsByVoucherType: Record<string, number>;
  countsByLineCountBucket: Record<string, number>;
  countsByBusinessOffsetMultiplicity: Record<string, number>;
  countsByBusinessOffsetCategory: Record<string, number>;
  countsByBusinessCurrencyPattern: Record<string, number>;
  countsByRiskFlag: Record<string, number>;
};

type Report = {
  summary: Summary;
  mainUseCases: MainUseCase[];
};

function renderSourceRowsTable(example: Example): string {
  const rowsHtml = example.sourceRows
    .map((row) => {
      const rowClass = row.isSettlementLine
        ? ' class="settlement-row"'
        : row.isCustomerLine
          ? ' class="cust-row"'
          : '';
      const flags: string[] = [];
      if (row.isSettlementLine) flags.push(badge('FX421103', 'settlement'));
      if (row.isNotesReceivableLine) flags.push(badge('Notes Rec.', 'notes'));
      if (row.isCustomerLine) flags.push(badge('Cust', 'cust'));
      if (
        row.isLedgerLine &&
        !row.isSettlementLine &&
        !row.isNotesReceivableLine
      ) {
        flags.push(badge('Ledger', 'ledger'));
      }

      return `<tr${rowClass}>
        <td class="num col-ln">${row.lineNumber}</td>
        <td class="col-atype">${esc(row.accountType)}</td>
        <td class="mono small col-adv" title="${esc(row.accountDisplayValue)}">${esc(row.accountDisplayValue)}</td>
        <td class="mono small col-main" title="${esc(row.mainAccount)}">${esc(row.mainAccount)}</td>
        <td class="num col-amt">${row.debitAmount > 0 ? fmt(row.debitAmount) : ''}</td>
        <td class="num col-amt">${row.creditAmount > 0 ? fmt(row.creditAmount) : ''}</td>
        <td class="col-ccy">${esc(row.currencyCode)}</td>
        <td class="mono small col-inv" title="${esc(row.invoice)}">${esc(row.invoice)}</td>
        <td class="col-flags">${flags.join(' ')}</td>
      </tr>`;
    })
    .join('');

  const truncNote = example.truncated
    ? `<tr class="trunc-note"><td colspan="9">⋯ showing first ${example.sourceRows.length} of ${example.totalRowsInGroup} rows</td></tr>`
    : '';

  const totalsRow = `<tr class="totals-row">
    <td colspan="4" class="totals-label">Totals</td>
    <td class="num"><strong>${fmt(example.totals.debit)}</strong></td>
    <td class="num"><strong>${fmt(example.totals.credit)}</strong></td>
    <td colspan="3"></td>
  </tr>`;

  return `
    <table class="source-table">
      <colgroup>
        <col class="col-ln">
        <col class="col-atype">
        <col class="col-adv">
        <col class="col-main">
        <col class="col-amt">
        <col class="col-amt">
        <col class="col-ccy">
        <col class="col-inv">
        <col class="col-flags">
      </colgroup>
      <thead>
        <tr>
          <th class="num col-ln">#</th>
          <th class="col-atype">Acct Type</th>
          <th class="col-adv">Account Display Value</th>
          <th class="col-main">Main Account</th>
          <th class="num col-amt">Debit</th>
          <th class="num col-amt">Credit</th>
          <th class="col-ccy">Ccy</th>
          <th class="col-inv">Invoice</th>
          <th class="col-flags">Flags</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${truncNote}
        ${totalsRow}
      </tbody>
    </table>`;
}

function renderVariant(variant: Variant, showSettlementBadge: boolean): string {
  const d = variant.details;
  const compositionStr = Object.entries(d.accountTypeComposition)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const mainAccStr =
    d.ledgerMainAccounts.length > 0 ? d.ledgerMainAccounts.join(', ') : '—';
  const nrAccStr =
    d.notesReceivableMainAccounts.length > 0
      ? d.notesReceivableMainAccounts.join(', ')
      : '—';
  const settleBadge = showSettlementBadge
    ? badge('FX421103', 'settlement')
    : '';

  const exampleHtml = variant.examples
    .slice(0, 1)
    .map(
      (ex) => `
      <div class="example-block">
        <div class="example-uid-bar">
          <span class="uid-label">UniqueId</span>
          <span class="uid-value">${ex.uniqueId}</span>
          ${
            ex.truncated
              ? `<span class="trunc-label">⋯ first ${ex.sourceRows.length} of ${ex.totalRowsInGroup} rows shown</span>`
              : ''
          }
        </div>
        ${renderSourceRowsTable(ex)}
      </div>`,
    )
    .join('');

  const vd = (lbl: string, val: string | number, strong = false) =>
    `<span class="vd-item"><span class="vd-lbl">${lbl}</span><span class="vd-val${strong ? ' vd-strong' : ''}">${val}</span></span>`;

  return `
    <div class="variant-block">
      <div class="variant-header">
        <span class="variant-id">${esc(variant.variantId)}</span>
        <span class="variant-freq">${fmt(variant.frequency)}×</span>
        ${settleBadge}
      </div>
      <div class="vd-strip">
        ${vd('Lines', d.exactLineCount)}
        ${vd('Composition', compositionStr)}
        ${vd('Cust lines', d.customerLines)}
        ${vd('Offset lines', d.offsetLines)}
        ${vd('Ledger lines', d.ledgerLines)}
        ${vd('Settlement', d.settlementLines, d.settlementLines > 0)}
        ${vd('Notes Rec.', d.notesReceivableLines)}
        ${vd('Balanced', d.isBalancedInSource ? '✓ Yes' : '✗ No')}
        ${vd('Currencies', d.currencies.join(', '))}
        ${vd('Offset types', d.offsetAccountTypes.join(', '))}
        ${vd('Ledger accts', mainAccStr)}
        ${vd('Notes Rec. accts', nrAccStr)}
      </div>
      ${exampleHtml}
    </div>`;
}

const REVIEW_FIELDS: Array<[string, number]> = [
  ['Accounting Decision', 3],
  ['Required DFO Account', 2],
  ['Required DFO Offset', 2],
  ['Credit Amount Rule', 2],
  ['Currency / Exchange-Rate Rule', 2],
  ['Settlement / FX Handling', 2],
  ['Marked Invoice Rule', 2],
  ['Notes', 3],
  ['Approved By', 1],
  ['Approved Date', 1],
];

function renderReviewArea(): string {
  const lines = Array.from(
    { length: 7 },
    () => '<div class="ruled-line"></div>',
  ).join('');
  return `
    <div class="review-area">
      <div class="review-title">— Accounting Review —</div>
      ${lines}
    </div>`;
}

function renderUseCase(uc: MainUseCase, index: number): string {
  const hasRisk =
    uc.riskFlags.hasSettlementLines ||
    uc.riskFlags.hasMixedCurrencies ||
    uc.riskFlags.cartesianProductRiskInCurrentProcessor;
  const maxVariants = hasRisk ? 4 : 2;
  const visibleVariants = uc.variants.slice(0, maxVariants);

  const businessPills = Object.entries(uc.businessClassification)
    .map(([k, v]) => classificationPill(k, String(v)))
    .join('');

  const detailedPills = Object.entries(uc.classification)
    .filter(([k]) => !['safeType', 'voucherType'].includes(k))
    .map(([k, v]) => classificationPill(k, String(v)))
    .join('');

  const variantsHtml = visibleVariants
    .map((v) => renderVariant(v, uc.riskFlags.hasSettlementLines))
    .join('');

  const hiddenVariants = uc.variantCount - visibleVariants.length;
  const hiddenNote =
    hiddenVariants > 0
      ? `<p class="hidden-note">+ ${hiddenVariants} more variant(s) not shown in print</p>`
      : '';

  const cpb = uc.currentProcessorBehavior;
  const cpbNotes = cpb.notes.map((n) => `<li>${esc(n)}</li>`).join('');

  const pageBreak = index > 0 ? ' page-break' : '';

  return `
    <section class="use-case${pageBreak}">
      <div class="uc-header">
        <div class="uc-id">${esc(uc.useCaseId)}</div>
        <div class="uc-title">${esc(uc.title)}</div>
        <div class="uc-meta">
          <span>Frequency: <strong>${fmt(uc.frequency)}</strong></span>
          <span>Variants: <strong>${uc.variantCount}</strong></span>
        </div>
        <div class="uc-risk">${riskBadges(uc.riskFlags)}</div>
      </div>

      <div class="uc-meta-strip">
        <div class="cl-pills">${businessPills}</div>
        <div class="cl-pills cl-pills-detail">${detailedPills}</div>
        <div class="cpb-strip">
          <span class="cpb-item"><span class="cpb-lbl">Removes settlement</span><span class="cpb-val">${cpb.removesSettlementLinesBeforeMapping ? 'Yes' : 'No'}</span></span>
          <span class="cpb-item"><span class="cpb-lbl">Lines after removal</span><span class="cpb-val">${esc(cpb.lineCountAfterSettlementRemovalPattern)}</span></span>
          <span class="cpb-item"><span class="cpb-lbl">Formula</span><span class="cpb-val"><code>${esc(cpb.expectedGeneratedLineCountFormula)}</code></span></span>
          <span class="cpb-item"><span class="cpb-lbl">Cartesian risk</span><span class="cpb-val ${cpb.hasCartesianProductRisk ? 'cpb-danger' : ''}">${cpb.hasCartesianProductRisk ? 'YES' : 'No'}</span></span>
        </div>
      </div>

      <h4>Variants</h4>
      ${variantsHtml}
      ${hiddenNote}

      ${renderReviewArea()}
    </section>`;
}

function buildToc(useCases: MainUseCase[]): string {
  const rows = useCases
    .map(
      (uc) => `
      <tr>
        <td><a href="#${uc.useCaseId}">${esc(uc.useCaseId)}</a></td>
        <td>${esc(uc.title)}</td>
        <td class="num">${fmt(uc.frequency)}</td>
        <td class="num">${uc.variantCount}</td>
        <td>${riskBadges(uc.riskFlags)}</td>
      </tr>`,
    )
    .join('');

  return `
    <section class="toc page-break">
      <h2>Table of Contents</h2>
      <table class="toc-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th class="num">Freq.</th>
            <th class="num">Variants</th>
            <th>Risk Flags</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function buildCoverPage(summary: Summary): string {
  const generated = new Date(summary.generatedAt).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const riskRows = Object.entries(summary.countsByRiskFlag)
    .map(
      ([flag, count]) =>
        `<tr><td>${esc(flag.replace(/([A-Z])/g, ' $1').trim())}</td><td class="num">${fmt(count)}</td></tr>`,
    )
    .join('');

  return `
    <section class="cover">
      <div class="cover-title">Cash-In Mapping Use Cases Review</div>
      <div class="cover-subtitle">D365FO Middleware — Accounting Review Document</div>

      <table class="cover-meta">
        <tr><td>Source File</td><td>${esc(summary.sourceFile)}</td></tr>
        <tr><td>Generated</td><td>${esc(generated)}</td></tr>
        <tr><td>Total Rows</td><td>${fmt(summary.totalRows)}</td></tr>
        <tr><td>Total Cash-In Rows</td><td>${fmt(summary.totalCashInRows)}</td></tr>
        <tr><td>Total Unique IDs</td><td>${fmt(summary.totalUniqueIds)}</td></tr>
        <tr><td>Total Main Use Cases</td><td>${fmt(summary.totalMainUseCases)}</td></tr>
        <tr><td>Total Variants</td><td>${fmt(summary.totalVariants)}</td></tr>
        <tr><td>Included Safe Types</td><td>${esc(summary.includedSafeTypes.join(', '))}</td></tr>
        <tr><td>Excluded Safe Types</td><td>${esc(summary.excludedSafeTypes.join(', ') || '—')}</td></tr>
      </table>

      <div class="cover-counts">
        ${countTable('By Safe Type', summary.countsBySafeType)}
        ${countTable('By Voucher Type', summary.countsByVoucherType)}
        ${countTable('By Offset Category', summary.countsByBusinessOffsetCategory)}
        ${countTable('By Offset Multiplicity', summary.countsByBusinessOffsetMultiplicity)}
        ${countTable('By Currency Pattern', summary.countsByBusinessCurrencyPattern)}
      </div>

      <div class="risk-summary">
        <h3>Risk Summary (main use cases)</h3>
        <table class="summary-table">
          <thead><tr><th>Risk Flag</th><th class="num">Use Cases</th></tr></thead>
          <tbody>${riskRows}</tbody>
        </table>
      </div>
    </section>`;
}

function buildCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 9.5pt;
      color: #111;
      background: #fff;
      padding: 0;
    }

    a { color: #111; text-decoration: none; }

    /* ── page/print layout ─────────────────────────────────────── */
    @media print {
      @page { size: A4 portrait; margin: 10mm 10mm 12mm 10mm; }
      body { font-size: 7.5pt; }
      .page-break { page-break-before: always; }
      .use-case { page-break-inside: avoid; }
      .variant-block { page-break-inside: avoid; }
      .review-area { page-break-inside: avoid; }
    }
    @media screen {
      body { padding: 24px; background: #e8e8e8; }
      section { background: #fff; margin: 0 auto 32px; padding: 28px 32px;
                max-width: 210mm; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    }

    /* ── typography ────────────────────────────────────────────── */
    h2 { font-size: 12pt; border-bottom: 2px solid #111; padding-bottom: 3px; margin-bottom: 8px; }
    h3 { font-size: 10pt; margin: 10px 0 5px; }
    h4 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em;
         color: #444; margin: 6px 0 4px; border-bottom: 1px solid #ccc; padding-bottom: 1px; }
    code { font-family: 'Consolas', monospace; font-size: 7.5pt; background: #f4f4f4;
           padding: 1px 3px; border-radius: 2px; }
    .mono { font-family: 'Consolas', monospace; }
    .small { font-size: 8pt; }
    .num  { text-align: right; white-space: nowrap; }

    /* ── cover ─────────────────────────────────────────────────── */
    .cover-title    { font-size: 20pt; font-weight: 700; margin-bottom: 4px; }
    .cover-subtitle { font-size: 11pt; color: #555; margin-bottom: 20px; }
    .cover-meta  { border-collapse: collapse; margin-bottom: 16px; width: 100%; }
    .cover-meta td { padding: 3px 8px 3px 0; vertical-align: top; }
    .cover-meta td:first-child { font-weight: 600; white-space: nowrap; width: 180px; }
    .cover-counts { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .cover-counts .summary-table { flex: 1; min-width: 140px; }

    /* ── summary tables ─────────────────────────────────────────── */
    .summary-table { border-collapse: collapse; font-size: 9pt; width: 100%; }
    .summary-table th, .summary-table td { padding: 3px 6px; border: 1px solid #ccc; }
    .summary-table th { background: #f0f0f0; text-align: left; }
    .risk-summary { margin-top: 16px; }

    /* ── toc ────────────────────────────────────────────────────── */
    .toc-table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
    .toc-table th, .toc-table td { padding: 3px 6px; border: 1px solid #ccc; vertical-align: top; }
    .toc-table th { background: #f0f0f0; }
    .toc-table tr:nth-child(even) td { background: #fafafa; }

    /* ── use case sections ──────────────────────────────────────── */
    .use-case  { margin-bottom: 16px; }
    .uc-header { border-left: 4px solid #222; padding-left: 10px; margin-bottom: 5px; }
    .uc-id     { font-size: 7pt; font-weight: 700; text-transform: uppercase;
                 letter-spacing: .08em; color: #555; margin-bottom: 1px; }
    .uc-title  { font-size: 11pt; font-weight: 700; margin-bottom: 3px; line-height: 1.2; }
    .uc-meta   { font-size: 7.5pt; color: #444; margin-bottom: 3px; }
    .uc-meta span { margin-right: 12px; }
    .uc-risk   { margin-top: 2px; }

    /* ── meta strip (classification + CPB) ─────────────────────── */
    .uc-meta-strip { background: #f8f8f8; border: 1px solid #e0e0e0;
                     border-radius: 3px; padding: 4px 8px; margin-bottom: 6px; }

    /* classification pills */
    .cl-pills         { display: flex; flex-wrap: wrap; gap: 3px 6px; margin-bottom: 3px;
                        padding-bottom: 3px; border-bottom: 1px solid #e0e0e0; }
    .cl-pills-detail  { opacity: .7; font-size: 6pt; margin-top: 0; }
    .cl-pill          { display: inline-flex; align-items: baseline; gap: 3px; font-size: 6.5pt; }
    .cl-key           { color: #666; font-weight: 700; white-space: nowrap; }
    .cl-val           { color: #111; word-break: break-word; }

    /* CPB inline strip */
    .cpb-strip { display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: 6.5pt; }
    .cpb-item  { display: inline-flex; align-items: baseline; gap: 3px; }
    .cpb-lbl   { color: #666; font-weight: 700; white-space: nowrap; }
    .cpb-val   { color: #111; word-break: break-word; }
    .cpb-danger { font-weight: 700; color: #000; text-decoration: underline; }

    /* ── variant detail strip ───────────────────────────────────── */
    .vd-strip  { display: flex; flex-wrap: wrap; gap: 2px 10px;
                 font-size: 6.5pt; margin-bottom: 4px;
                 background: #f4f4f4; border: 1px solid #e0e0e0;
                 border-radius: 3px; padding: 3px 6px; }
    .vd-item   { display: inline-flex; align-items: baseline; gap: 3px; }
    .vd-lbl    { color: #666; font-weight: 700; white-space: nowrap; }
    .vd-val    { color: #111; }
    .vd-strong { font-weight: 700; color: #000; }

    /* ── variants ───────────────────────────────────────────────── */
    .variant-block { border: 1px solid #ddd; border-radius: 3px; margin-bottom: 6px;
                     padding: 5px 8px; }
    .variant-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .variant-id   { font-weight: 700; font-size: 7.5pt; font-family: 'Consolas', monospace; }
    .variant-freq { background: #eee; border-radius: 10px; padding: 1px 6px;
                    font-size: 7pt; font-weight: 600; }
    .hidden-note  { font-size: 7pt; color: #888; font-style: italic; margin: 2px 0 4px; }

    /* ── example uid bar ────────────────────────────────────────── */
    .example-block    { margin-top: 4px; }
    .example-uid-bar  { display: flex; align-items: center; gap: 8px;
                        background: #111; color: #fff;
                        border-radius: 3px 3px 0 0;
                        padding: 3px 8px; font-size: 7.5pt; }
    .uid-label        { font-weight: 700; text-transform: uppercase;
                        letter-spacing: .1em; color: #aaa; font-size: 6pt; }
    .uid-value        { font-family: 'Consolas', monospace; font-size: 9.5pt;
                        font-weight: 700; letter-spacing: .03em; }
    .trunc-label      { font-style: italic; font-size: 7pt;
                        color: #ccc; margin-left: auto; }

    /* ── source rows table ──────────────────────────────────────── */
    .source-table { border-collapse: collapse; width: 100%; font-size: 7pt;
                    table-layout: fixed; }
    /* header: solid dark strip matching the uid bar */
    .source-table thead tr th {
      background: #333; color: #fff;
      padding: 2px 5px; text-align: left;
      white-space: nowrap; overflow: hidden;
      border-right: 1px solid #555;
      font-size: 6.5pt; font-weight: 700; letter-spacing: .03em;
    }
    .source-table thead tr th.num { text-align: right; }
    /* body cells */
    .source-table td { padding: 2px 5px; border-bottom: 1px solid #d8d8d8;
                       border-right: 1px solid #ebebeb;
                       vertical-align: top; word-break: break-all;
                       overflow-wrap: anywhere; }
    /* zebra stripe — very light, prints as near-white */
    .source-table tbody tr:nth-child(even) td { background: #f7f7f7; }
    /* outer border */
    .source-table { border: 1px solid #999; }
    /* settlement row: distinct grey shade, prints clearly in B&W */
    .settlement-row td { background: #d8d8d8 !important; }
    /* customer row: lightest grey tint */
    .cust-row td { background: #f2f2f2 !important; }
    /* truncation / totals */
    .trunc-note td { font-style: italic; color: #666; font-size: 7pt;
                     text-align: center; padding: 4px;
                     word-break: normal; background: #f7f7f7; }
    .totals-row td { background: #e8e8e8; font-size: 8pt; font-weight: 700;
                     border-top: 2px solid #555; word-break: normal; }
    .totals-label { font-weight: 700; text-align: right; }

    /* column widths */
    .col-ln    { width: 28px; }
    .col-atype { width: 68px; }
    .col-adv   { width: 22%; }
    .col-main  { width: 72px; }
    .col-amt   { width: 66px; text-align: right; }
    .col-ccy   { width: 36px; white-space: nowrap; }
    .col-inv   { width: 18%; }
    .col-flags { width: 62px; }

    /* ── badges ─────────────────────────────────────────────────── */
    /* On screen: subtle tints.
       On print:  all badges collapse to black-bordered outlined text
       so they read clearly in B&W. */
    .badge { display: inline-block; border-radius: 2px; padding: 1px 4px;
             font-size: 6.5pt; font-weight: 700; white-space: nowrap;
             border: 1.5px solid #555; color: #111; background: #fff; }
    /* screen-only tints */
    @media screen {
      .badge-settlement { background: #f5f5f5; border-color: #333;
                          color: #111; }
      .badge-currency   { background: #efefef; border-color: #555; }
      .badge-multi      { background: #f0f0f0; border-color: #555; }
      .badge-ledger     { background: #f5f5f5; border-color: #444; }
      .badge-notes      { background: #f5f5f5; border-color: #444; }
      .badge-danger     { background: #e8e8e8; border-color: #222;
                          color: #111; font-style: italic; }
      .badge-cust       { background: #f8f8f8; border-color: #555; }
    }
    /* settlement badge gets an underline to stand out extra in B&W */
    .badge-settlement { text-decoration: underline; font-style: italic; }
    .badge-danger     { font-style: italic; }
    .no-risk          { color: #999; font-style: italic; font-size: 8pt; }

    /* ── review area ────────────────────────────────────────────── */
    .review-area  { border: 1.5px solid #999; border-radius: 3px; padding: 6px 10px;
                    margin-top: 8px; background: #fff; }
    .review-title { font-weight: 700; font-size: 8pt; letter-spacing: .05em;
                    text-align: center; margin-bottom: 6px; color: #444; }
    .ruled-line   { border-bottom: 1px solid #bbb; height: 18px; }
  `;
}

function buildHtml(report: Report): string {
  const { summary, mainUseCases } = report;

  const coverHtml = buildCoverPage(summary);
  const tocHtml = buildToc(mainUseCases);
  const useCasesHtml = mainUseCases
    .map((uc, index) => {
      const section = renderUseCase(uc, index);
      return `<section id="${uc.useCaseId}" class="use-case page-break">${section}</section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cash-In Mapping Use Cases Review</title>
  <style>${buildCss()}</style>
</head>
<body>
  ${coverHtml}
  ${tocHtml}
  ${useCasesHtml}
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
  console.error('Failed to render report.');
  console.error(error);
  process.exitCode = 1;
});
