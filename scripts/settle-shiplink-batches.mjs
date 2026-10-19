#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_D365_URL =
  'https://mesco.sandbox.operations.eu.dynamics.com';
const SETTLEMENT_PATH = '/data/PaymentJournalLineSettledInvoices';

function usage() {
  console.log(`Usage:
  node scripts/settle-shiplink-batches.mjs --file <SettlementLines.json> --batch <Mesco-000016627>
  node scripts/settle-shiplink-batches.mjs --file <SettlementLines.json> --all

Options:
  --file <path>       Complete SettlementLines.json file
  --batch <number>    Post one Dynamics journal batch
  --all               Post every batch in the file, sequentially
  --url <url>         D365FO base URL (default: D365FO_BASE_URL or ${DEFAULT_D365_URL})
  --token <token>     D365FO bearer token (default: D365FO_TOKEN)
  --data-area-id <id> DataAreaId header (default: D365FO_DATA_AREA_ID or m-p)
  --timeout-ms <ms>   Per-line request timeout (default: 120000)
`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

const fileName = argument('--file');
const selectedBatch = argument('--batch')?.trim();
const runAll = process.argv.includes('--all');
const d365BaseUrl = (
  argument('--url') || process.env.D365FO_BASE_URL || DEFAULT_D365_URL
).replace(/\/+$/, '');
const token = argument('--token') || process.env.D365FO_TOKEN;
const dataAreaId =
  argument('--data-area-id') || process.env.D365FO_DATA_AREA_ID || 'm-p';
const timeoutMs = Number(argument('--timeout-ms') || 120_000);

if (!fileName || (!selectedBatch && !runAll) || (selectedBatch && runAll)) {
  usage();
  process.exit(2);
}
if (!token) {
  console.error('Missing D365FO token. Use --token or D365FO_TOKEN.');
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('--timeout-ms must be a positive number.');
  process.exit(2);
}

const inputPath = path.resolve(fileName);
let rows;
try {
  rows = JSON.parse(await fs.readFile(inputPath, 'utf8'));
} catch (error) {
  console.error(`Could not read JSON file ${inputPath}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(rows)) {
  console.error('SettlementLines.json must contain a top-level JSON array.');
  process.exit(1);
}

const batches = [
  ...new Set(
    rows
      .map((row) => String(row?.JournalBatchNumber ?? '').trim())
      .filter(Boolean),
  ),
];
const batchesToRun = runAll ? batches : [selectedBatch];
const endpoint = `${d365BaseUrl}${SETTLEMENT_PATH}`;
let posted = 0;
let failed = 0;
let failedBatches = 0;

console.log(`Loaded ${rows.length} settlement row(s) from ${inputPath}.`);
console.log(`Posting directly to ${endpoint}`);
console.log(`Running ${batchesToRun.length} batch(es) sequentially.`);

for (const batch of batchesToRun) {
  const batchRows = rows.filter(
    (row) =>
      String(row?.JournalBatchNumber ?? '').trim().toLowerCase() ===
      batch.toLowerCase(),
  );
  if (batchRows.length === 0) {
    console.error(`Batch ${batch}: no rows found.`);
    failedBatches += 1;
    continue;
  }

  console.log(`Batch ${batch}: posting ${batchRows.length} line(s)...`);
  let batchFailed = false;
  for (let index = 0; index < batchRows.length; index += 1) {
    const row = batchRows[index];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          DataAreaId: dataAreaId,
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`${response.status} ${responseText}`.trim());
      }
      posted += 1;
      if ((index + 1) % 50 === 0 || index === batchRows.length - 1) {
        console.log(`  ${index + 1}/${batchRows.length} line(s) accepted.`);
      }
    } catch (error) {
      failed += 1;
      batchFailed = true;
      console.error(
        `  line ${row?.JournalLineNumber ?? '?'} / invoice ${row?.InvoiceNumber ?? '?'} failed: ${error.message}`,
      );
    }
  }
  if (batchFailed) failedBatches += 1;
}

console.log(
  `Finished: accepted=${posted}, failed=${failed}, failedBatches=${failedBatches}.`,
);
if (failed > 0 || failedBatches > 0) process.exitCode = 1;
