import fs from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';

const SANDBOX_HOST = 'mesco.sandbox.operations.eu.dynamics.com';
const DEFAULT_POSTMAN = path.resolve(
  'D365FO OData APis.postman_collection_5439.json',
);
const DEFAULT_ENV = path.resolve('.env.local');
const MONEY_TOLERANCE = 0.01;

function parseArgs(argv) {
  const options = {
    file: '',
    sheet: '',
    row: 0,
    executeOne: false,
    executeAll: false,
    confirm: '',
    exportRequests: '',
    concurrency: 6,
    envFile: DEFAULT_ENV,
    postman: DEFAULT_POSTMAN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--file':
        options.file = path.resolve(next());
        break;
      case '--sheet':
        options.sheet = next();
        break;
      case '--row':
        options.row = Number(next());
        break;
      case '--env-file':
        options.envFile = path.resolve(next());
        break;
      case '--postman':
        options.postman = path.resolve(next());
        break;
      case '--export-requests':
        options.exportRequests = path.resolve(next());
        break;
      case '--concurrency':
        options.concurrency = Number(next());
        break;
      case '--execute-one':
        options.executeOne = true;
        break;
      case '--execute-all':
        options.executeAll = true;
        break;
      case '--confirm':
        options.confirm = next();
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.file) throw new Error('--file is required');
  if (options.executeOne && options.executeAll) {
    throw new Error('Use either --execute-one or --execute-all, not both');
  }
  if (options.executeOne && !Number.isInteger(options.row)) {
    throw new Error('--execute-one requires an integer --row');
  }
  if (options.executeAll && options.confirm !== 'MARK-ALL') {
    throw new Error('--execute-all requires --confirm MARK-ALL');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new Error('--concurrency must be an integer from 1 to 12');
  }
  return options;
}

function printHelp() {
  console.log(`
Mark vendor-payment journal lines from descriptions like "Unmarked - <invoice>".

Dry-run one Excel row:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --file <xlsx> --row 2

Execute exactly one Excel row:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --file <xlsx> --row 2 --execute-one

Execute every valid candidate (explicit confirmation required):
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --file <xlsx> --execute-all --confirm MARK-ALL

Resolve all candidates with GET requests and export Postman Runner data:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --file <xlsx> --export-requests <json>

Options:
  --sheet <name>       Worksheet name; defaults to the first worksheet
  --env-file <path>    D365 credential file; defaults to .env.local
  --postman <path>     Postman collection used to resolve baseURL
  --concurrency <n>    Parallel GET-only resolution workers; defaults to 6
`);
}

async function loadEnvFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadBaseUrl(postmanPath, env) {
  const collection = JSON.parse(await fs.readFile(postmanPath, 'utf8'));
  const baseUrl = collection.variable?.find(
    (variable) => variable.key === 'baseURL',
  )?.value;
  return String(baseUrl || env.D365FO_RESOURCE || '').replace(/\/$/, '');
}

async function getAccessToken(env, baseUrl) {
  const required = [
    'D365FO_AUTHORITY',
    'D365FO_TENANT_ID',
    'D365FO_CLIENT_ID',
    'D365FO_CLIENT_SECRET',
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing D365 settings: ${missing.join(', ')}`);
  }

  const tokenUrl = `${env.D365FO_AUTHORITY.replace(/\/$/, '')}/${env.D365FO_TENANT_ID}/oauth2/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.D365FO_CLIENT_ID,
      client_secret: env.D365FO_CLIENT_SECRET,
      resource: baseUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(`D365 authentication failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('D365 returned no access token');
  return data.access_token;
}

function odataLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildODataUrl(baseUrl, entity, query = {}) {
  const url = new URL(`/data/${entity}`, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

async function d365Request(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message =
      body?.error?.innererror?.message ||
      body?.error?.message ||
      body?.Message ||
      body?.message ||
      String(body || response.statusText);
    throw new Error(`D365 HTTP ${response.status}: ${message}`);
  }
  return body;
}

async function odataGet(token, baseUrl, entity, query) {
  const body = await d365Request(
    token,
    buildODataUrl(baseUrl, entity, query),
  );
  return body?.value ?? [];
}

function cellValue(row, indexByHeader, name) {
  return row.getCell(indexByHeader.get(name)).value;
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  if (typeof value === 'object' && 'result' in value) return String(value.result);
  return String(value).trim();
}

function asNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric value: ${value}`);
  return number;
}

function invoiceFromDescription(description) {
  return description.match(/^\s*unmarked\s*[-:]\s*(.+?)\s*$/i)?.[1]?.trim() || '';
}

async function readCandidates(options) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.file);
  const sheet = options.sheet
    ? workbook.getWorksheet(options.sheet)
    : workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no matching worksheet');

  const headerRow = sheet.getRow(1);
  const indexByHeader = new Map();
  headerRow.eachCell((cell, columnNumber) => {
    indexByHeader.set(asText(cell.value), columnNumber);
  });
  const required = [
    'Voucher',
    'Company',
    'Account',
    'Description',
    'Debit',
    'Credit',
    'Currency',
    'Line number',
  ];
  const missing = required.filter((name) => !indexByHeader.has(name));
  if (missing.length) throw new Error(`Missing workbook columns: ${missing.join(', ')}`);

  const candidates = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const description = asText(cellValue(row, indexByHeader, 'Description'));
    const invoice = invoiceFromDescription(description);
    if (!invoice) continue;
    candidates.push({
      rowNumber,
      voucher: asText(cellValue(row, indexByHeader, 'Voucher')),
      company: asText(cellValue(row, indexByHeader, 'Company')),
      vendorAccount: asText(cellValue(row, indexByHeader, 'Account')),
      description,
      invoice,
      debit: asNumber(cellValue(row, indexByHeader, 'Debit')),
      credit: asNumber(cellValue(row, indexByHeader, 'Credit')),
      currency: asText(cellValue(row, indexByHeader, 'Currency')),
      lineNumber: asNumber(cellValue(row, indexByHeader, 'Line number')),
    });
  }
  return { sheetName: sheet.name, candidates };
}

function isOpenVendTrans(row) {
  const closed = String(row.Closed ?? '').trim();
  return !closed || closed.startsWith('1900-01-01');
}

function moneyEquals(left, right) {
  return Math.abs(Number(left) - Number(right)) <= MONEY_TOLERANCE;
}

async function prepareSettlement(token, baseUrl, candidate) {
  const journalFilter = [
    `dataAreaId eq ${odataLiteral(candidate.company)}`,
    `Voucher eq ${odataLiteral(candidate.voucher)}`,
    `LineNumber eq ${candidate.lineNumber}`,
  ].join(' and ');
  const journalLines = await odataGet(
    token,
    baseUrl,
    'VendorPaymentJournalLines',
    { 'cross-company': 'true', $filter: journalFilter, $top: '2' },
  );
  if (journalLines.length !== 1) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: expected one D365 journal line but found ${journalLines.length}`,
    );
  }
  const journalLine = journalLines[0];
  if (
    asText(journalLine.AccountDisplayValue).toLowerCase() !==
    candidate.vendorAccount.toLowerCase()
  ) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: vendor mismatch (${candidate.vendorAccount} vs ${journalLine.AccountDisplayValue})`,
    );
  }
  if (asText(journalLine.CurrencyCode) !== candidate.currency) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: currency mismatch (${candidate.currency} vs ${journalLine.CurrencyCode})`,
    );
  }
  if (
    !moneyEquals(journalLine.DebitAmount, candidate.debit) ||
    !moneyEquals(journalLine.CreditAmount, candidate.credit)
  ) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: journal amount does not match the workbook`,
    );
  }

  const invoiceFilter = [
    `dataAreaId eq ${odataLiteral(candidate.company)}`,
    `AccountNum eq ${odataLiteral(candidate.vendorAccount)}`,
    `Invoice eq ${odataLiteral(candidate.invoice)}`,
  ].join(' and ');
  const invoiceRows = await odataGet(token, baseUrl, 'VendTransBiEntities', {
    'cross-company': 'true',
    $filter: invoiceFilter,
    $top: '20',
  });
  const openInvoices = invoiceRows.filter(
    (row) =>
      isOpenVendTrans(row) &&
      asText(row.CurrencyCode) === candidate.currency,
  );
  if (openInvoices.length !== 1) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: expected one open invoice transaction but found ${openInvoices.length}`,
    );
  }
  const invoiceRow = openInvoices[0];
  const settlementAmount = Number((candidate.credit - candidate.debit).toFixed(2));
  if (!settlementAmount) {
    throw new Error(`Excel row ${candidate.rowNumber}: settlement amount is zero`);
  }
  const remainingAmount = Math.abs(
    asNumber(invoiceRow.AmountCur) - asNumber(invoiceRow.SettleAmountCur),
  );
  if (Math.abs(settlementAmount) - remainingAmount > MONEY_TOLERANCE) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: settlement ${Math.abs(settlementAmount)} exceeds invoice remainder ${remainingAmount}`,
    );
  }

  const journalBatchNumber = asText(journalLine.JournalBatchNumber);
  const duplicateFilter = [
    `JournalLineCompany eq ${odataLiteral(candidate.company)}`,
    `JournalBatchNumber eq ${odataLiteral(journalBatchNumber)}`,
    `JournalLineNumber eq ${candidate.lineNumber}`,
    `InvoiceNumber eq ${odataLiteral(candidate.invoice)}`,
    `InvoiceCompany eq ${odataLiteral(candidate.company)}`,
  ].join(' and ');
  const existing = await odataGet(
    token,
    baseUrl,
    'VendorPaymentJournalLineSettledInvoices',
    { 'cross-company': 'true', $filter: duplicateFilter, $top: '2' },
  );

  const payload = {
    JournalLineCompany: candidate.company,
    JournalBatchNumber: journalBatchNumber,
    JournalLineNumber: candidate.lineNumber,
    InvoiceNumber: candidate.invoice,
    InvoiceCompany: candidate.company,
    InvoiceDueDate: invoiceRow.DueDate,
    SettlementAmountInInvoiceCurrency: settlementAmount,
    CashDiscountToTakeInInvoiceCurrency: 0,
  };

  return { candidate, journalLine, invoiceRow, existing, payload };
}

function printPlan(plan, status) {
  console.log(
    JSON.stringify(
      {
        status,
        excelRow: plan.candidate.rowNumber,
        voucher: plan.candidate.voucher,
        journalBatchNumber: plan.payload.JournalBatchNumber,
        journalLineNumber: plan.payload.JournalLineNumber,
        vendorAccount: plan.candidate.vendorAccount,
        invoiceNumber: plan.payload.InvoiceNumber,
        settlementAmount: plan.payload.SettlementAmountInInvoiceCurrency,
        currency: plan.candidate.currency,
      },
      null,
      2,
    ),
  );
}

async function postAndVerify(token, baseUrl, plan) {
  if (plan.existing.length > 0) {
    printPlan(plan, 'already_marked');
    return 'already_marked';
  }

  await d365Request(
    token,
    buildODataUrl(baseUrl, 'VendorPaymentJournalLineSettledInvoices'),
    { method: 'POST', body: JSON.stringify(plan.payload) },
  );

  const verifyFilter = [
    `JournalLineCompany eq ${odataLiteral(plan.payload.JournalLineCompany)}`,
    `JournalBatchNumber eq ${odataLiteral(plan.payload.JournalBatchNumber)}`,
    `JournalLineNumber eq ${plan.payload.JournalLineNumber}`,
    `InvoiceNumber eq ${odataLiteral(plan.payload.InvoiceNumber)}`,
    `InvoiceCompany eq ${odataLiteral(plan.payload.InvoiceCompany)}`,
  ].join(' and ');
  const verified = await odataGet(
    token,
    baseUrl,
    'VendorPaymentJournalLineSettledInvoices',
    { 'cross-company': 'true', $filter: verifyFilter, $top: '2' },
  );
  if (verified.length !== 1) {
    throw new Error(
      `POST completed but verification found ${verified.length} settlement rows`,
    );
  }
  if (
    !moneyEquals(
      verified[0].SettlementAmountInInvoiceCurrency,
      plan.payload.SettlementAmountInInvoiceCurrency,
    )
  ) {
    throw new Error('POST completed but the verified settlement amount differs');
  }
  printPlan(plan, 'marked_and_verified');
  return 'marked_and_verified';
}

function toPostmanDataRow(plan) {
  return {
    requestName: `Excel row ${plan.candidate.rowNumber} - ${plan.candidate.invoice}`,
    excelRow: plan.candidate.rowNumber,
    voucher: plan.candidate.voucher,
    vendorAccount: plan.candidate.vendorAccount,
    currency: plan.candidate.currency,
    JournalLineCompany: plan.payload.JournalLineCompany,
    JournalBatchNumber: plan.payload.JournalBatchNumber,
    JournalLineNumber: plan.payload.JournalLineNumber,
    InvoiceNumber: plan.payload.InvoiceNumber,
    InvoiceCompany: plan.payload.InvoiceCompany,
    InvoiceDueDate: plan.payload.InvoiceDueDate,
    SettlementAmountInInvoiceCurrency:
      plan.payload.SettlementAmountInInvoiceCurrency,
    CashDiscountToTakeInInvoiceCurrency:
      plan.payload.CashDiscountToTakeInInvoiceCurrency,
  };
}

async function exportPostmanRequests(
  token,
  baseUrl,
  candidates,
  outputPath,
  concurrency,
) {
  const results = new Array(candidates.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      try {
        const plan = await prepareSettlement(token, baseUrl, candidate);
        results[index] = {
          status: plan.existing.length > 0 ? 'already_marked' : 'ready',
          candidate,
          payload: plan.payload,
        };
      } catch (error) {
        results[index] = {
          status: 'invalid',
          candidate,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      completed += 1;
      if (completed % 20 === 0 || completed === candidates.length) {
        console.log(`Resolved=${completed}/${candidates.length}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
      worker(),
    ),
  );

  const ready = results
    .filter((result) => result.status === 'ready')
    .map((result) =>
      toPostmanDataRow({ candidate: result.candidate, payload: result.payload }),
    );
  const reportPath = outputPath.replace(/\.json$/i, '.report.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(ready, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sandbox: baseUrl,
        sourceCandidateCount: candidates.length,
        readyCount: ready.length,
        alreadyMarkedCount: results.filter(
          (result) => result.status === 'already_marked',
        ).length,
        invalidCount: results.filter((result) => result.status === 'invalid')
          .length,
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return {
    outputPath,
    reportPath,
    readyCount: ready.length,
    alreadyMarkedCount: results.filter(
      (result) => result.status === 'already_marked',
    ).length,
    invalidCount: results.filter((result) => result.status === 'invalid').length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = { ...(await loadEnvFile(options.envFile)), ...process.env };
  const baseUrl = await loadBaseUrl(options.postman, env);
  const baseHost = new URL(baseUrl).hostname.toLowerCase();
  if (baseHost !== SANDBOX_HOST) {
    throw new Error(
      `Refusing to run against ${baseHost}; this script is locked to ${SANDBOX_HOST}`,
    );
  }
  const token = await getAccessToken(env, baseUrl);
  const { sheetName, candidates } = await readCandidates(options);
  if (candidates.length === 0) throw new Error('No Unmarked descriptions found');

  if (options.exportRequests) {
    console.log(
      `Workbook=${path.basename(options.file)} Sheet=${sheetName} Candidates=${candidates.length} Mode=GET_ONLY_EXPORT`,
    );
    const summary = await exportPostmanRequests(
      token,
      baseUrl,
      candidates,
      options.exportRequests,
      options.concurrency,
    );
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  let selected;
  if (options.row) {
    selected = candidates.filter((candidate) => candidate.rowNumber === options.row);
    if (selected.length !== 1) {
      throw new Error(`Excel row ${options.row} is not an Unmarked candidate`);
    }
  } else if (options.executeAll) {
    selected = candidates;
  } else {
    throw new Error('Specify --row for a dry-run/test, or use --execute-all');
  }

  console.log(
    `Workbook=${path.basename(options.file)} Sheet=${sheetName} Candidates=${candidates.length} Selected=${selected.length}`,
  );

  let markedAndVerified = 0;
  let alreadyMarked = 0;
  let invalid = 0;
  let postFailed = 0;
  for (const candidate of selected) {
    let plan;
    try {
      plan = await prepareSettlement(token, baseUrl, candidate);
    } catch (error) {
      if (!options.executeAll) throw error;
      invalid += 1;
      console.error(
        JSON.stringify({
          status: 'invalid',
          excelRow: candidate.rowNumber,
          voucher: candidate.voucher,
          vendorAccount: candidate.vendorAccount,
          invoiceNumber: candidate.invoice,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      continue;
    }
    if (!options.executeOne && !options.executeAll) {
      printPlan(plan, plan.existing.length ? 'already_marked' : 'dry_run_ready');
      continue;
    }
    try {
      const status = await postAndVerify(token, baseUrl, plan);
      if (status === 'already_marked') alreadyMarked += 1;
      else markedAndVerified += 1;
    } catch (error) {
      if (!options.executeAll) throw error;
      postFailed += 1;
      console.error(
        JSON.stringify({
          status: 'post_failed',
          excelRow: candidate.rowNumber,
          voucher: candidate.voucher,
          vendorAccount: candidate.vendorAccount,
          invoiceNumber: candidate.invoice,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (options.executeOne) break;
  }

  if (options.executeOne || options.executeAll) {
    console.log(
      JSON.stringify({
        markedAndVerified,
        alreadyMarked,
        invalid,
        postFailed,
      }),
    );
    if (postFailed > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
