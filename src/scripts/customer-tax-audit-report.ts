/**
 * customer-tax-audit-report.ts
 *
 * Read-only audit script. Connects to the same MongoDB used by the backend,
 * reads the local `customers` collection, detects duplicate and missing
 * `taxExemptNumber` values, and generates a self-contained printable HTML
 * report suitable for Finance review.
 *
 * Usage:
 *   pnpm customer-tax-audit
 *
 * Required env var:
 *   MONGODB_URI — same variable used by the NestJS backend.
 *
 * Output:
 *   reports/customer-tax-audit-report.html  (relative to CWD)
 *
 * This script DOES NOT modify any database record.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import mongoose from 'mongoose';

// Use the native collection type returned by mongoose.Connection.db.collection().
// We avoid importing from 'mongodb' directly (it is not in package.json as a direct
// dependency) and rely on type inference to satisfy TypeScript.
type NativeCollection = ReturnType<
  NonNullable<mongoose.Connection['db']>['collection']
>;

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT = '.reports/customer-tax-audit-report.html';

/**
 * Normalisation: only trim outer whitespace and collapse internal runs of
 * whitespace to a single space. We deliberately do NOT strip dashes,
 * dots, or slashes because those are meaningful in many tax-number formats
 * (e.g. Egyptian National-ID format XXX-XXXXXXX-XXXXX-X).
 *
 * Placeholder detection is kept separate so Finance can see exactly which
 * sentinel values were found.
 */
function normaliseTaxNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Values that are considered "as-good-as-missing".
 * Stored as lower-cased strings for case-insensitive comparison.
 * Edit this set to adjust placeholder detection.
 */
const PLACEHOLDER_VALUES_LOWER = new Set<string>(['n/a', 'na', '-', '--', '0']);

function isMissingTaxNumber(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const trimmed = raw.trim();
  if (trimmed === '') return true;
  if (PLACEHOLDER_VALUES_LOWER.has(trimmed.toLowerCase())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Movement status
// ---------------------------------------------------------------------------

/**
 * The local MongoDB schema for data_enhanced_records and data_source_records
 * stores the record payload in a generic `data: Record<string, any>` field.
 * Because the structure of that field depends on the entry-processor type and
 * is not documented in schema types, we cannot reliably extract a
 * customerAccount from it without risking false positives or false negatives.
 *
 * Therefore movement status is uniformly reported as UNKNOWN.
 * See the Technical Notes section of the generated report for details.
 */
type MovementStatus =
  | 'Has local movements'
  | 'No local movements found'
  | 'Unknown — not enough local data';

const MOVEMENT_UNKNOWN: MovementStatus = 'Unknown — not enough local data';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

// interface RawCustomer {
//   _id: string;
//   company: string;
//   customerAccount: string;
//   name?: string;
//   taxExemptNumber?: string;
// }

// /** Shape of each element pushed into the `customers` array by the aggregation pipeline. */
// interface AggregatedCustomer {
//   customerAccount: string;
//   name?: string;
//   company: string;
//   originalTaxNumber: string;
// }

interface CustomerRow {
  customerAccount: string;
  name: string;
  company: string;
  originalTaxNumber: string;
  normalisedTaxNumber: string;
  movementStatus: MovementStatus;
  suggestedAction: string;
}

interface DuplicateGroup {
  normalisedTaxNumber: string;
  customerCount: number;
  riskLevel: 'High' | 'Medium';
  customers: CustomerRow[];
}

interface MissingRow {
  customerAccount: string;
  name: string;
  company: string;
  taxNumberStatus: string;
}

interface AuditResult {
  totalScanned: number;
  duplicateGroups: DuplicateGroup[];
  duplicateTaxNumberCount: number;
  duplicateCustomerAccountCount: number;
  missingRows: MissingRow[];
  generatedAt: Date;
  environment: string;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function esc(v: unknown): string {
  const s =
    v == null
      ? ''
      : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function buildCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 9.5pt;
      color: #111;
      background: #fff;
    }

    a { color: #111; }

    /* ── Print / A4 layout ─────────────────────────────────────── */
    @media print {
      @page { size: A4 portrait; margin: 12mm 12mm 14mm 12mm; }
      body  { font-size: 8pt; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      section { page-break-inside: avoid; }
      table { page-break-inside: auto; }
      tr    { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
    @media screen {
      body { background: #e4e4e4; padding: 28px; }
      .report-wrapper { background: #fff; max-width: 210mm;
        margin: 0 auto; padding: 32px 36px;
        box-shadow: 0 3px 12px rgba(0,0,0,.18); }
    }

    /* ── Typography ─────────────────────────────────────────────── */
    h1 { font-size: 18pt; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 12pt; font-weight: 700;
         border-bottom: 2px solid #111;
         padding-bottom: 3px; margin: 22px 0 10px; }
    h3 { font-size: 10pt; font-weight: 700; margin: 14px 0 6px; }
    h4 { font-size: 8.5pt; font-weight: 700; text-transform: uppercase;
         letter-spacing: .04em; color: #444; margin: 10px 0 4px; }
    p  { margin-bottom: 6px; line-height: 1.5; }
    ul, ol { margin: 4px 0 8px 18px; line-height: 1.6; }
    code { font-family: 'Consolas', 'Courier New', monospace;
           font-size: 8pt; background: #f4f4f4;
           padding: 1px 3px; border-radius: 2px; }

    /* ── Cover ──────────────────────────────────────────────────── */
    .cover-header { border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 18px; }
    .cover-subtitle { font-size: 11pt; color: #555; margin-bottom: 12px; }
    .cover-meta { border-collapse: collapse; width: 100%; margin-bottom: 0; }
    .cover-meta td { padding: 3px 8px 3px 0; vertical-align: top; font-size: 9pt; }
    .cover-meta td:first-child { font-weight: 600; white-space: nowrap; width: 200px; }

    /* ── Executive summary cards ─────────────────────────────────── */
    .summary-cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
    .card {
      border: 1.5px solid #bbb; border-radius: 3px;
      padding: 8px 14px; min-width: 130px; flex: 1;
      text-align: center;
    }
    .card-value { font-size: 20pt; font-weight: 700; line-height: 1.1; }
    .card-label { font-size: 7.5pt; color: #555; text-transform: uppercase;
                  letter-spacing: .05em; margin-top: 2px; }
    .card-warn  { border-color: #555; background: #f8f8f8; }
    .card-ok    { border-color: #999; background: #fff; }

    /* ── Duplicate group blocks ──────────────────────────────────── */
    .dup-group {
      border: 1.5px solid #aaa; border-radius: 3px;
      margin-bottom: 14px; padding: 8px 10px;
      page-break-inside: avoid;
    }
    .dup-group-header {
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;
      margin-bottom: 6px; padding-bottom: 5px;
      border-bottom: 1px solid #ccc;
    }
    .dup-tax  { font-family: 'Consolas', monospace; font-size: 10pt;
                font-weight: 700; }
    .dup-count { font-size: 8pt; color: #555; }
    .risk-badge {
      display: inline-block; border: 1.5px solid #555;
      border-radius: 2px; padding: 1px 6px; font-size: 7.5pt;
      font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    }
    .risk-high   { border-color: #222; font-style: italic; }
    .risk-medium { border-color: #555; }

    /* ── Data tables ─────────────────────────────────────────────── */
    .data-table {
      border-collapse: collapse; width: 100%;
      font-size: 7.5pt; table-layout: auto;
    }
    .data-table th {
      background: #222; color: #fff;
      padding: 3px 6px; text-align: left;
      font-size: 7pt; font-weight: 700;
      letter-spacing: .03em; white-space: nowrap;
      border-right: 1px solid #444;
    }
    .data-table td {
      padding: 3px 6px; border-bottom: 1px solid #ddd;
      border-right: 1px solid #ebebeb;
      vertical-align: top; word-break: break-word;
    }
    .data-table tbody tr:nth-child(even) td { background: #f8f8f8; }
    .data-table { border: 1px solid #999; }
    .mono { font-family: 'Consolas', monospace; font-size: 7.5pt; }
    .action-cell { font-style: italic; color: #333; font-size: 7pt; }
    .status-unknown { color: #666; font-style: italic; }

    /* ── Methodology / notes ─────────────────────────────────────── */
    .info-box {
      border: 1px solid #bbb; border-radius: 3px;
      background: #fafafa; padding: 8px 12px;
      margin: 8px 0 12px; font-size: 8.5pt;
    }
    .info-box p { margin-bottom: 4px; }

    /* ── Finance actions ─────────────────────────────────────────── */
    .action-list li { margin-bottom: 5px; }

    /* ── Footer ─────────────────────────────────────────────────── */
    .report-footer {
      margin-top: 24px; padding-top: 8px;
      border-top: 1px solid #ccc;
      font-size: 7pt; color: #777; text-align: center;
    }
  `;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildCoverSection(result: AuditResult): string {
  const generated = result.generatedAt.toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  });

  return `
    <div class="cover-header">
      <h1>Customer Tax Number Audit Report</h1>
      <div class="cover-subtitle">Duplicate and Missing Tax Number Review</div>
      <table class="cover-meta">
        <tr><td>Generated</td><td>${esc(generated)}</td></tr>
        <tr><td>Environment</td><td>${esc(result.environment)}</td></tr>
        <tr><td>Data Source</td><td>Local MongoDB — <code>customers</code> collection</td></tr>
        <tr><td>Prepared by</td><td>Middleware Development Team</td></tr>
        <tr><td>Intended for</td><td>Finance Team — for review and action only</td></tr>
      </table>
    </div>`;
}

function buildExecutiveSummary(result: AuditResult): string {
  const hasIssues =
    result.duplicateGroups.length > 0 || result.missingRows.length > 0;

  return `
    <h2>1. Executive Summary</h2>
    <div class="summary-cards">
      <div class="card card-ok">
        <div class="card-value">${fmt(result.totalScanned)}</div>
        <div class="card-label">Total Customers Scanned</div>
      </div>
      <div class="card ${result.duplicateGroups.length > 0 ? 'card-warn' : 'card-ok'}">
        <div class="card-value">${fmt(result.duplicateTaxNumberCount)}</div>
        <div class="card-label">Duplicate Tax Numbers</div>
      </div>
      <div class="card ${result.duplicateCustomerAccountCount > 0 ? 'card-warn' : 'card-ok'}">
        <div class="card-value">${fmt(result.duplicateCustomerAccountCount)}</div>
        <div class="card-label">Affected Customer Accounts</div>
      </div>
      <div class="card ${result.missingRows.length > 0 ? 'card-warn' : 'card-ok'}">
        <div class="card-value">${fmt(result.missingRows.length)}</div>
        <div class="card-label">Missing Tax Number</div>
      </div>
    </div>
    ${
      hasIssues
        ? `<p>This audit identified <strong>${fmt(result.duplicateTaxNumberCount)}</strong>
           duplicate tax number(s) affecting <strong>${fmt(result.duplicateCustomerAccountCount)}</strong>
           customer account(s), and <strong>${fmt(result.missingRows.length)}</strong>
           customer(s) with a missing or invalid tax number.
           Finance review and corrective action are required before these records can be
           used reliably in AR processing.</p>`
        : `<p>No duplicate or missing tax numbers were found. The customer master data is
           clean with respect to tax number uniqueness and completeness.</p>`
    }`;
}

function buildMethodologySection(): string {
  return `
    <h2>2. Methodology</h2>
    <div class="info-box">
      <p><strong>Data source:</strong> Local MongoDB <code>customers</code> collection.
      All data is synced from Dynamics 365 Finance &amp; Operations (D365FO) by the
      Middleware sync process. This report reflects the state of the local copy at
      the time of generation.</p>

      <p><strong>Tax number field:</strong> <code>taxExemptNumber</code> (Mongoose schema
      field mapped from the D365FO <code>TaxExemptNumber</code> entity attribute).</p>

      <p><strong>Normalisation logic:</strong> Before duplicate detection, each tax number
      is normalised by (1) trimming leading and trailing whitespace, and (2) collapsing
      any internal run of whitespace characters to a single space.
      Dashes, dots, slashes, and other punctuation are preserved because they carry
      structural meaning in many regional tax-number formats.
      The original stored value is always shown alongside the normalised form.</p>

      <p><strong>Missing tax number detection:</strong> A tax number is considered missing
      if it is <code>null</code>, <code>undefined</code>, an empty string, a
      whitespace-only string, or one of the known placeholder values:
      <code>N/A</code>, <code>NA</code>, <code>-</code>, <code>--</code>, <code>0</code>
      (case-insensitive). These placeholders are configurable in the script source
      (<code>PLACEHOLDER_VALUES_LOWER</code>).</p>

      <p><strong>Movement detection:</strong> Movement status is reported as
      <em>"Unknown — not enough local data"</em> for all customers.
      The local MongoDB stores batch-processing records (<code>data_enhanced_records</code>,
      <code>data_source_records</code>) with payloads in a generic
      <code>data: Record&lt;string, any&gt;</code> field whose internal structure varies by
      entry-processor type and is not typed in schema definitions.
      Extracting a reliable customer account reference from those payloads would require
      entry-processor–specific logic that cannot safely generalise across all processors.
      See Section 5 — Technical Notes for details and recommended next steps.</p>
    </div>`;
}

function buildDuplicatesSection(groups: DuplicateGroup[]): string {
  if (groups.length === 0) {
    return `
      <h2>3. Duplicate Tax Numbers</h2>
      <p>No duplicate tax numbers were found.</p>`;
  }

  const groupBlocks = groups
    .map((g) => {
      const riskClass = g.riskLevel === 'High' ? 'risk-high' : 'risk-medium';
      const rows = g.customers
        .map(
          (c) => `
          <tr>
            <td class="mono">${esc(c.customerAccount)}</td>
            <td>${esc(c.name)}</td>
            <td>${esc(c.company)}</td>
            <td class="mono">${esc(c.originalTaxNumber)}</td>
            <td class="mono">${esc(c.normalisedTaxNumber)}</td>
            <td class="status-unknown">${esc(c.movementStatus)}</td>
            <td class="action-cell">${esc(c.suggestedAction)}</td>
          </tr>`,
        )
        .join('');

      return `
        <div class="dup-group">
          <div class="dup-group-header">
            <span class="dup-tax">${esc(g.normalisedTaxNumber)}</span>
            <span class="dup-count">${fmt(g.customerCount)} customers</span>
            <span class="risk-badge ${riskClass}">Risk: ${esc(g.riskLevel)}</span>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Customer Account</th>
                <th>Customer Name</th>
                <th>Company</th>
                <th>Original Tax Number</th>
                <th>Normalised Tax Number</th>
                <th>Movement Status</th>
                <th>Suggested Action</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })
    .join('');

  return `
    <h2 class="page-break">3. Duplicate Tax Numbers</h2>
    <p>The following <strong>${fmt(groups.length)}</strong> normalised tax number(s)
    are shared by more than one customer account. Groups are sorted by customer
    count (descending), then by normalised tax number (ascending).</p>
    ${groupBlocks}`;
}

function buildMissingSection(rows: MissingRow[]): string {
  if (rows.length === 0) {
    return `
      <h2>4. Customers Missing Tax Number</h2>
      <p>No customers with a missing tax number were found.</p>`;
  }

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td class="mono">${esc(r.customerAccount)}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.company)}</td>
        <td class="action-cell">${esc(r.taxNumberStatus)}</td>
        <td class="action-cell">Finance must provide or confirm tax number.</td>
      </tr>`,
    )
    .join('');

  return `
    <h2 class="page-break">4. Customers Missing Tax Number</h2>
    <p>The following <strong>${fmt(rows.length)}</strong> customer account(s) have
    a missing, empty, or placeholder tax number. Sorted by company, then customer
    account.</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>Customer Account</th>
          <th>Customer Name</th>
          <th>Company</th>
          <th>Tax Number Status</th>
          <th>Suggested Action</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

function buildRecommendedActionsSection(): string {
  return `
    <h2 class="page-break">5. Recommended Finance Actions</h2>
    <div class="info-box">
      <p>The following actions are recommended based on this audit. The Development
      Team will not change any master data or transaction data without explicit
      Finance confirmation.</p>
    </div>
    <h3>Duplicate Tax Numbers</h3>
    <ul class="action-list">
      <li>Duplicate tax numbers cause ambiguity during AR processing: when the
      middleware searches customers by tax number, multiple records are returned,
      which prevents reliable invoice and payment matching.</li>
      <li>For each duplicate group, Finance should identify the canonical customer
      record and determine whether the duplicates are data-entry errors, merged
      entities, or distinct customers incorrectly sharing a tax number.</li>
      <li>If a duplicate customer has <strong>no movements</strong>, Finance should
      consider requesting its removal or deactivation in D365FO.</li>
      <li>If a duplicate customer <strong>has movements</strong>, it must not be
      deleted. Finance should review whether a master-data merge or tax-number
      correction is appropriate in D365FO.</li>
      <li>Because movement detection is currently unavailable locally (see Technical
      Notes), Finance should verify movement status directly in D365FO before
      taking action.</li>
    </ul>
    <h3>Customers Missing Tax Numbers</h3>
    <ul class="action-list">
      <li>Customers without a valid tax number cannot be correctly matched during
      AR processing and may cause tax-reporting gaps.</li>
      <li>Finance should provide the correct tax number for each listed customer,
      or confirm whether the customer is exempt and document the exemption.</li>
      <li>Once confirmed, the Development Team can coordinate with the D365FO
      administrator to update the record, which will be re-synced to the
      middleware automatically.</li>
    </ul>`;
}

function buildTechnicalNotesSection(): string {
  return `
    <h2 class="page-break">6. Technical Notes</h2>
    <div class="info-box">
      <h4>Movement Detection Limitation</h4>
      <p>The local MongoDB does not currently expose a reliable, schema-typed link
      between a specific customer account and its processed/posted transaction
      records. The available collections are:</p>
      <ul>
        <li><code>data_batches</code> — tracks processing batch jobs by company and
        entry-processor type, but does not store per-customer-account line data.</li>
        <li><code>data_enhanced_records</code> and <code>data_source_records</code>
        — store the raw payload in a generic <code>data: Record&lt;string, any&gt;</code>
        field whose internal structure varies by entry-processor type (AR, cash-in,
        cash-out, closing, etc.) and is not defined in schema types accessible to
        a standalone script.</li>
      </ul>
      <p>Attempting to scan the generic <code>data</code> field for customer account
      strings would risk false positives and false negatives. Until a typed projection
      or a dedicated index of customer-to-batch linkage is implemented, movement status
      cannot be determined locally and is marked as
      <em>"Unknown — not enough local data"</em>.</p>
      <p><strong>Recommendation:</strong> Finance should verify movement status directly
      in D365FO (Accounts Receivable &gt; Customers &gt; Customer Transactions) for any
      customer account flagged in this report before requesting removal or deactivation.</p>

      <h4>Script Safety</h4>
      <p>This script is read-only. It opens a MongoDB connection, runs aggregation and
      find queries only, writes a local HTML file, and disconnects. It does not call any
      D365FO API, does not modify any document, and does not enqueue any background jobs.</p>

      <h4>Re-running the Report</h4>
      <p>The report reflects the state of the local MongoDB at the time of generation.
      After Finance actions have been taken and the sync has run, re-run
      <code>pnpm customer-tax-audit</code> to generate a fresh report and confirm the
      issues have been resolved.</p>

      <h4>Normalisation Constants</h4>
      <p>The following placeholder values are treated as missing tax numbers (in addition
      to null / empty string): <code>N/A</code>, <code>NA</code>, <code>-</code>,
      <code>--</code>, <code>0</code>. To adjust this list, edit the
      <code>PLACEHOLDER_VALUES_LOWER</code> constant in the script source file.</p>
    </div>`;
}

function buildHtml(result: AuditResult): string {
  const generated = result.generatedAt.toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  });

  const body = [
    buildCoverSection(result),
    buildExecutiveSummary(result),
    buildMethodologySection(),
    buildDuplicatesSection(result.duplicateGroups),
    buildMissingSection(result.missingRows),
    buildRecommendedActionsSection(),
    buildTechnicalNotesSection(),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Customer Tax Number Audit Report — ${esc(generated)}</title>
  <style>${buildCss()}</style>
</head>
<body>
  <div class="report-wrapper">
    ${body}
    <div class="report-footer">
      Customer Tax Number Audit Report &nbsp;|&nbsp; Generated ${esc(generated)}
      &nbsp;|&nbsp; Middleware Development Team &nbsp;|&nbsp; Confidential — Finance Use Only
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// MongoDB aggregation
// ---------------------------------------------------------------------------

/**
 * Streams all customer documents through a cursor (projection to 4 fields),
 * applies isMissingTaxNumber() and normaliseTaxNumber() in TypeScript — the same
 * functions used by fetchMissingTaxNumberCustomers — and groups in memory.
 *
 * Why not a MongoDB aggregation pipeline?
 * MongoDB's $nin operator does NOT evaluate RegExp objects as pattern matchers;
 * it treats them as literal BSON values, so placeholder strings such as "N/A"
 * slipped through the original $match. Moving all classification logic to
 * TypeScript gives a single source of truth and eliminates BSON serialisation
 * surprises entirely.
 */
async function fetchDuplicateGroups(
  collection: NativeCollection,
): Promise<DuplicateGroup[]> {
  // Stream only the fields we need — keeps memory low on large collections.
  const cursor = collection.find(
    {},
    {
      projection: {
        customerAccount: 1,
        name: 1,
        company: 1,
        taxExemptNumber: 1,
      },
    },
  );

  // Group by normalised tax number.
  // Customers with a missing/placeholder tax number are skipped here —
  // they are handled separately by fetchMissingTaxNumberCustomers.
  const byNormalisedTax = new Map<
    string,
    Array<{
      customerAccount: string;
      name: string;
      company: string;
      originalTaxNumber: string;
    }>
  >();

  for await (const doc of cursor) {
    const raw = doc.taxExemptNumber as string | null | undefined;
    if (isMissingTaxNumber(raw)) continue;
    const rawStr = String(raw);
    const normalised = normaliseTaxNumber(rawStr);
    if (!byNormalisedTax.has(normalised)) {
      byNormalisedTax.set(normalised, []);
    }
    byNormalisedTax.get(normalised)!.push({
      customerAccount: String(doc.customerAccount ?? ''),
      name: String(doc.name ?? ''),
      company: String(doc.company ?? ''),
      originalTaxNumber: rawStr,
    });
  }

  // Build duplicate groups (2+ customers sharing the same normalised tax number).
  const groups: DuplicateGroup[] = [];

  for (const [normalisedTaxNumber, customers] of byNormalisedTax) {
    if (customers.length < 2) continue;

    // Sort within group: company asc, then customerAccount asc.
    customers.sort((a, b) => {
      const cmp = a.company.localeCompare(b.company);
      return cmp !== 0
        ? cmp
        : a.customerAccount.localeCompare(b.customerAccount);
    });

    const customerCount = customers.length;
    const riskLevel: 'High' | 'Medium' = customerCount > 2 ? 'High' : 'Medium';

    groups.push({
      normalisedTaxNumber,
      customerCount,
      riskLevel,
      customers: customers.map((c) => ({
        customerAccount: c.customerAccount,
        name: c.name || '—',
        company: c.company || '—',
        originalTaxNumber: c.originalTaxNumber,
        normalisedTaxNumber,
        movementStatus: MOVEMENT_UNKNOWN,
        suggestedAction:
          'Finance review required — movement status unknown. Verify in D365FO before taking action.',
      })),
    });
  }

  // Sort groups: customer count desc, then normalised tax number asc.
  groups.sort((a, b) =>
    b.customerCount !== a.customerCount
      ? b.customerCount - a.customerCount
      : a.normalisedTaxNumber.localeCompare(b.normalisedTaxNumber),
  );

  return groups;
}

/**
 * Returns all customers where taxExemptNumber is missing, empty, or a placeholder.
 * Uses a $match with $or to catch all cases efficiently at the DB level.
 */
async function fetchMissingTaxNumberCustomers(
  collection: NativeCollection,
): Promise<MissingRow[]> {
  const placeholders = Array.from(PLACEHOLDER_VALUES_LOWER);

  const query = {
    $or: [
      { taxExemptNumber: null },
      { taxExemptNumber: { $exists: false } },
      { taxExemptNumber: '' },
      // Whitespace-only: regex that matches strings with no non-whitespace character
      { taxExemptNumber: { $regex: /^\s*$/ } },
      // Placeholder values (case-insensitive)
      ...placeholders.map((p) => ({
        taxExemptNumber: {
          $regex: new RegExp(`^\\s*${escapeRegex(p)}\\s*$`, 'i'),
        },
      })),
    ],
  };

  const docs = await collection
    .find(query, {
      projection: {
        customerAccount: 1,
        name: 1,
        company: 1,
        taxExemptNumber: 1,
      },
      sort: { company: 1, customerAccount: 1 },
    })
    .toArray();

  return docs.map((doc) => {
    const rawTax = doc.taxExemptNumber;
    let taxNumberStatus = 'null / not set';
    if (rawTax != null) {
      const trimmed = String(rawTax).trim();
      if (trimmed === '') {
        taxNumberStatus = 'empty string';
      } else if (PLACEHOLDER_VALUES_LOWER.has(trimmed.toLowerCase())) {
        taxNumberStatus = `placeholder value: "${trimmed}"`;
      } else {
        taxNumberStatus = 'whitespace only';
      }
    }
    return {
      customerAccount: String(doc.customerAccount ?? ''),
      name: String(doc.name ?? '—'),
      company: String(doc.company ?? '—'),
      taxNumberStatus,
    };
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Load environment variables using the same pattern as migrate-legacy-admin.ts
  const environment = process.env.NODE_ENV ?? 'development';
  for (const path of [`.env.${environment}`, '.env.local', '.env']) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI environment variable is not set.');
    console.error(
      'Ensure the .env file (or .env.development / .env.local) is present and contains MONGODB_URI.',
    );
    process.exitCode = 1;
    return;
  }

  // 2. Determine output path
  const outputPath = resolve(process.cwd(), DEFAULT_OUTPUT);

  console.info('Customer Tax Number Audit Report');
  console.info('=================================');
  console.info(`Environment : ${environment}`);
  console.info(`Output path : ${outputPath}`);
  console.info('');

  // 3. Connect to MongoDB
  console.info('Connecting to MongoDB…');
  let connection: mongoose.Connection | undefined;
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
    connection = mongoose.connection;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to connect to MongoDB — ${msg}`);
    process.exitCode = 1;
    return;
  }

  const db = connection.db;
  if (!db) {
    console.error('Error: MongoDB connection is unavailable after connect().');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const customersCollection = db.collection('customers');

  try {
    // 4. Count total customers
    console.info('Counting total customers…');
    const totalScanned = await customersCollection.countDocuments({});
    console.info(`  Total customers: ${fmt(totalScanned)}`);

    // 5. Find duplicates via aggregation
    console.info('Running duplicate tax number aggregation…');
    const duplicateGroups = await fetchDuplicateGroups(customersCollection);
    const duplicateTaxNumberCount = duplicateGroups.length;
    const duplicateCustomerAccountCount = duplicateGroups.reduce(
      (sum, g) => sum + g.customerCount,
      0,
    );
    console.info(`  Duplicate tax numbers : ${fmt(duplicateTaxNumberCount)}`);
    console.info(
      `  Affected accounts     : ${fmt(duplicateCustomerAccountCount)}`,
    );

    // 6. Find customers missing tax number
    console.info('Querying customers with missing tax number…');
    const missingRows =
      await fetchMissingTaxNumberCustomers(customersCollection);
    console.info(`  Missing tax number    : ${fmt(missingRows.length)}`);

    // 7. Assemble result
    const result: AuditResult = {
      totalScanned,
      duplicateGroups,
      duplicateTaxNumberCount,
      duplicateCustomerAccountCount,
      missingRows,
      generatedAt: new Date(),
      environment,
    };

    // 8. Generate HTML
    console.info('');
    console.info('Generating HTML report…');
    const html = buildHtml(result);

    // 9. Write output file
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, 'utf8');

    // 10. CLI summary
    console.info('');
    console.info('── Report Summary ───────────────────────────────────────');
    console.info(`  Total customers scanned       : ${fmt(totalScanned)}`);
    console.info(
      `  Duplicate tax numbers          : ${fmt(duplicateTaxNumberCount)}`,
    );
    console.info(
      `  Duplicate customer accounts    : ${fmt(duplicateCustomerAccountCount)}`,
    );
    console.info(
      `  Missing tax number customers   : ${fmt(missingRows.length)}`,
    );
    console.info('─────────────────────────────────────────────────────────');
    console.info(`  Report written to : ${outputPath}`);
    console.info('');
    console.info(
      'To print as PDF: open the file in a browser and use File → Print → Save as PDF (A4, Portrait).',
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Unhandled error:');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
