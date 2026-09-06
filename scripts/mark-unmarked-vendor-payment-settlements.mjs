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
    journal: '',
    sourceFile: '',
    includeMarked: false,
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
      case '--journal':
        options.journal = next();
        break;
      case '--source-file':
        options.sourceFile = path.resolve(next());
        break;
      case '--include-marked':
        options.includeMarked = true;
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

  if (!options.file && !options.journal) {
    throw new Error('--file or --journal is required');
  }
  if (options.file && options.journal) {
    throw new Error('Use either --file or --journal, not both');
  }
  if (options.executeOne && options.executeAll) {
    throw new Error('Use either --execute-one or --execute-all, not both');
  }
  if (options.executeOne && !Number.isInteger(options.row)) {
    throw new Error('--execute-one requires an integer --row');
  }
  if (options.sourceFile && !options.journal) {
    throw new Error('--source-file requires --journal');
  }
  if (options.sourceFile) {
    options.includeMarked = true;
  }
  if (options.executeAll && options.confirm !== 'MARK-ALL') {
    throw new Error('--execute-all requires --confirm MARK-ALL');
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 12
  ) {
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

Mark unmarked and already-marked vendor lines from a D365 journal:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --journal Mesco-000015623 --include-marked --execute-all --confirm MARK-ALL

Mark a journal using invoice/document numbers from a Cash source-records workbook:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --journal Mesco-000015639 --source-file source-records.xlsx --execute-all --confirm MARK-ALL

Resolve all candidates with GET requests and export Postman Runner data:
  node scripts/mark-unmarked-vendor-payment-settlements.mjs --file <xlsx> --export-requests <json>

Options:
  --journal <id>       D365 VendorPaymentJournalLines batch number
  --source-file <xlsx> Overlay UniqueId/INVOICE/DOCUMENT from cash source records
  --include-marked     Also retry lines that are already marked / have no Unmarked invoice
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
      Prefer: 'odata.maxpagesize=5000',
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
  return odataGetAll(token, buildODataUrl(baseUrl, entity, query).toString());
}

async function odataGetAll(token, firstUrl) {
  const rows = [];
  let next = firstUrl;
  while (next) {
    const body = await d365Request(token, next);
    rows.push(...(body?.value ?? []));
    next = body?.['@odata.nextLink'] || '';
  }
  return rows;
}

function cellValue(row, indexByHeader, name) {
  return row.getCell(indexByHeader.get(name)).value;
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  if (typeof value === 'object' && 'result' in value)
    return String(value.result);
  return String(value).trim();
}

function asNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number))
    throw new Error(`Invalid numeric value: ${value}`);
  return number;
}

function invoiceFromDescription(description) {
  const text = String(description ?? '').trim();
  return (
    text.match(/^\s*unmarked\s*[-:]\s*(.+?)\s*$/i)?.[1]?.trim() ||
    text.match(/\bunmarked\s*[-:]\s*(.+?)\s*$/i)?.[1]?.trim() ||
    ''
  );
}

function isPlaceholderInvoice(invoice) {
  const text = String(invoice ?? '').trim();
  return !text || /^(0+)$/i.test(text);
}

function isCustodyCreditCandidate(candidate) {
  return Number(candidate.credit) > 0 && Number(candidate.debit) === 0;
}

function sourceInvoiceMatches(rowInvoice, sourceInvoice) {
  const left = asText(rowInvoice).toLowerCase();
  const right = asText(sourceInvoice).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

async function readSourceVendorRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The source workbook has no worksheet');

  const headerRow = sheet.getRow(1);
  const indexByHeader = new Map();
  headerRow.eachCell((cell, columnNumber) => {
    indexByHeader.set(asText(cell.value), columnNumber);
  });
  const required = [
    'UniqueId',
    'LINENUMBER',
    'ACCOUNTTYPE',
    'ACCOUNTDISPLAYVALUE',
    'INVOICE',
    'DOCUMENT',
    'DEBITAMOUNT',
    'CREDITAMOUNT',
    'CURRENCYCODE',
  ];
  const missing = required.filter((name) => !indexByHeader.has(name));
  if (missing.length) {
    throw new Error(`Missing source-file columns: ${missing.join(', ')}`);
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const accountType = asText(cellValue(row, indexByHeader, 'ACCOUNTTYPE'));
    if (!/^(vend|vendor)$/i.test(accountType)) continue;
    rows.push({
      excelRow: rowNumber,
      uniqueId: asText(cellValue(row, indexByHeader, 'UniqueId')),
      line: asNumber(cellValue(row, indexByHeader, 'LINENUMBER')),
      account: asText(cellValue(row, indexByHeader, 'ACCOUNTDISPLAYVALUE')),
      invoice: asText(cellValue(row, indexByHeader, 'INVOICE')),
      document: asText(cellValue(row, indexByHeader, 'DOCUMENT')),
      debit: asNumber(cellValue(row, indexByHeader, 'DEBITAMOUNT')),
      credit: asNumber(cellValue(row, indexByHeader, 'CREDITAMOUNT')),
      currency: asText(cellValue(row, indexByHeader, 'CURRENCYCODE')),
      dueDate: indexByHeader.has('DUEDATE')
        ? asText(cellValue(row, indexByHeader, 'DUEDATE'))
        : '',
    });
  }
  return rows;
}

function overlaySourceInvoices(candidates, sourceRows) {
  const usedExcelRows = new Set();
  for (const candidate of candidates) {
    const uniqueId = asText(candidate.journalLine?.PaymentId);
    const vendor = asText(candidate.vendorAccount).toLowerCase();
    const lineNumber = Number(candidate.lineNumber);
    const unused = sourceRows.filter(
      (row) =>
        !usedExcelRows.has(row.excelRow) &&
        String(row.uniqueId) === uniqueId &&
        asText(row.account).toLowerCase() === vendor,
    );
    const amountMatches = unused.filter(
      (row) =>
        moneyEquals(row.debit, candidate.debit) &&
        moneyEquals(row.credit, candidate.credit),
    );
    const exactLine = unused.filter((row) => Number(row.line) === lineNumber);
    // D365 LineNumber is the journal line, not the Excel LINENUMBER. Prefer
    // UniqueId + vendor + amount so two lines with the same invoice but
    // different documents keep their own DOCUMENT/INVOICE.
    const pool = (
      amountMatches.length > 0
        ? amountMatches
        : exactLine.length > 0
          ? exactLine
          : unused
    ).slice();
    pool.sort(
      (left, right) =>
        Math.abs(Number(left.line) - lineNumber) -
        Math.abs(Number(right.line) - lineNumber),
    );
    const chosen = pool[0];
    if (!chosen) continue;
    usedExcelRows.add(chosen.excelRow);
    candidate.sourceExcelRow = chosen.excelRow;
    candidate.sourceUniqueId = chosen.uniqueId;
    candidate.sourceDocument = chosen.document;
    candidate.sourceDueDate = chosen.dueDate;
    candidate.sourceInvoices = [
      ...new Set(
        [asText(chosen.invoice)]
          .filter((invoice) => !isPlaceholderInvoice(invoice)),
      ),
    ];
    if (!isPlaceholderInvoice(chosen.invoice)) {
      candidate.invoice = chosen.invoice;
    }
  }
}

function isAlreadyMarkedError(message) {
  const text = String(message ?? '');
  return (
    /has been marked for settlement/i.test(text) ||
    /already marked/i.test(text) ||
    /no longer available for payment/i.test(text) ||
    /settled by another user/i.test(text)
  );
}

function finTagTokens(finTag) {
  return String(finTag || '')
    .split('|')
    .map((part) =>
      part
        .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
        .trim(),
    )
    .filter(Boolean);
}

function transKey(row) {
  return [
    String(row.AccountNum ?? '').trim().toLowerCase(),
    String(row.Invoice ?? '').trim().toLowerCase(),
    String(row.DocumentNum ?? '').trim().toLowerCase(),
    String(row.Voucher ?? '').trim().toLowerCase(),
    String(row.DueDate ?? '').trim(),
    String(row.AmountCur ?? ''),
  ].join('|');
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
  if (missing.length)
    throw new Error(`Missing workbook columns: ${missing.join(', ')}`);

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

async function readJournalCandidates(token, baseUrl, options) {
  const journalFilter = `JournalBatchNumber eq ${odataLiteral(options.journal)}`;
  const lines = await odataGet(token, baseUrl, 'VendorPaymentJournalLines', {
    'cross-company': 'true',
    $filter: journalFilter,
  });
  const settlements = await odataGet(
    token,
    baseUrl,
    'VendorPaymentJournalLineSettledInvoices',
    { 'cross-company': 'true', $filter: journalFilter },
  );
  const settlementsByLine = new Map();
  for (const row of settlements) {
    const lineNumber = Number(row.JournalLineNumber);
    if (!settlementsByLine.has(lineNumber)) {
      settlementsByLine.set(lineNumber, []);
    }
    settlementsByLine.get(lineNumber).push(row);
  }

  const candidates = [];
  for (const line of lines) {
    if (String(line.AccountType || '').toLowerCase() !== 'vend') continue;
    const description = asText(line.TransactionText || line.Text || '');
    const unmarkedInvoice = invoiceFromDescription(description);
    const markedInvoice = asText(line.MarkedInvoice);
    const existing = settlementsByLine.get(Number(line.LineNumber)) || [];
    const existingInvoice = asText(existing[0]?.InvoiceNumber);
    const invoice = unmarkedInvoice || markedInvoice || existingInvoice;
    const settleVoucher = asText(line.SettleVoucher);
    const alreadyMarked =
      settleVoucher === 'SelectedTransact' || existing.length > 0;
    if (!options.includeMarked && alreadyMarked && !unmarkedInvoice) continue;
    if (
      !options.includeMarked &&
      !unmarkedInvoice &&
      !alreadyMarked &&
      !/unmarked/i.test(description)
    ) {
      continue;
    }
    candidates.push({
      rowNumber: Number(line.LineNumber),
      voucher: asText(line.Voucher),
      company: asText(line.dataAreaId || line.Company),
      vendorAccount: asText(line.AccountDisplayValue),
      description,
      invoice,
      debit: asNumber(line.DebitAmount),
      credit: asNumber(line.CreditAmount),
      currency: asText(line.CurrencyCode),
      lineNumber: asNumber(line.LineNumber),
      journalBatchNumber: asText(line.JournalBatchNumber),
      settleVoucher,
      finTag: asText(line.FinTagDisplayValue),
      alreadyMarked,
      existingSettlements: existing,
      journalLine: line,
    });
  }
  return {
    sheetName: options.journal,
    candidates,
    settlements,
  };
}

function isOpenVendTrans(row) {
  const closed = String(row.Closed ?? '').trim();
  return !closed || closed.startsWith('1900-01-01');
}

function moneyEquals(left, right) {
  return Math.abs(Number(left) - Number(right)) <= MONEY_TOLERANCE;
}

function signedSettlementAmount(credit, debit) {
  return Number(credit || 0) - Number(debit || 0);
}

async function findOpenInvoiceRows(token, baseUrl, candidate, usedKeys) {
  const settlementAmount = signedSettlementAmount(
    candidate.credit,
    candidate.debit,
  );
  const absAmount = Math.abs(settlementAmount);
  const tokens = new Set(
    finTagTokens(candidate.finTag).map((token) => token.toLowerCase()),
  );
  const invoicesToTry = [
    ...new Set(
      [asText(candidate.invoice), ...(candidate.sourceInvoices || [])]
        .map((value) => asText(value))
        .filter((value) => !isPlaceholderInvoice(value)),
    ),
  ];
  const document = asText(candidate.sourceDocument);
  const invoiceRows = [];
  const seenRowKeys = new Set();
  const pushRows = (rows) => {
    for (const row of rows) {
      const key = transKey(row);
      if (seenRowKeys.has(key)) continue;
      seenRowKeys.add(key);
      invoiceRows.push(row);
    }
  };

  for (const invoice of invoicesToTry) {
    const invoiceFilter = [
      `dataAreaId eq ${odataLiteral(candidate.company)}`,
      `AccountNum eq ${odataLiteral(candidate.vendorAccount)}`,
      `Invoice eq ${odataLiteral(invoice)}`,
    ].join(' and ');
    pushRows(
      await odataGet(token, baseUrl, 'VendTransBiEntities', {
        'cross-company': 'true',
        $filter: invoiceFilter,
        $top: '50',
      }),
    );
  }

  if (document) {
    const documentFilter = [
      `dataAreaId eq ${odataLiteral(candidate.company)}`,
      `AccountNum eq ${odataLiteral(candidate.vendorAccount)}`,
      `DocumentNum eq ${odataLiteral(document)}`,
    ].join(' and ');
    pushRows(
      await odataGet(token, baseUrl, 'VendTransBiEntities', {
        'cross-company': 'true',
        $filter: documentFilter,
        $top: '50',
      }),
    );
  }

  if (invoiceRows.length === 0) {
    for (const invoice of invoicesToTry) {
      const startsFilter = [
        `dataAreaId eq ${odataLiteral(candidate.company)}`,
        `AccountNum eq ${odataLiteral(candidate.vendorAccount)}`,
        `startswith(Invoice, ${odataLiteral(invoice)})`,
      ].join(' and ');
      pushRows(
        await odataGet(token, baseUrl, 'VendTransBiEntities', {
          'cross-company': 'true',
          $filter: startsFilter,
          $top: '50',
        }),
      );
    }
  }

  if (invoiceRows.length === 0 && invoicesToTry.length === 0) {
    const amountFilter = [
      `dataAreaId eq ${odataLiteral(candidate.company)}`,
      `AccountNum eq ${odataLiteral(candidate.vendorAccount)}`,
      `Closed eq 1900-01-01T12:00:00Z`,
      `(AmountCur eq ${absAmount} or AmountCur eq ${-absAmount})`,
    ].join(' and ');
    pushRows(
      await odataGet(token, baseUrl, 'VendTransBiEntities', {
        'cross-company': 'true',
        $filter: amountFilter,
        $top: '50',
      }),
    );
  }

  const sourceMatched = (row) => {
    const invoiceMatch = invoicesToTry.some((invoice) =>
      sourceInvoiceMatches(row.Invoice, invoice),
    );
    const documentMatch =
      Boolean(document) &&
      asText(row.DocumentNum).toLowerCase() === document.toLowerCase();
    return { invoiceMatch, documentMatch };
  };

  const openInvoices = invoiceRows.filter((row) => {
    if (!isOpenVendTrans(row)) return false;
    if (asText(row.CurrencyCode) !== candidate.currency) return false;
    if (usedKeys?.has(transKey(row))) return false;
    const remainingAmount = Math.abs(
      asNumber(row.AmountCur) - asNumber(row.SettleAmountCur),
    );
    const { invoiceMatch, documentMatch } = sourceMatched(row);
    if (document && !documentMatch) return false;
    const remainingTolerance =
      invoiceMatch || documentMatch ? Math.max(1, MONEY_TOLERANCE) : MONEY_TOLERANCE;
    return (
      remainingAmount + remainingTolerance >= absAmount || remainingAmount > 0
    );
  });

  const ranked = [...openInvoices].sort((left, right) => {
    const leftMatch = sourceMatched(left);
    const rightMatch = sourceMatched(right);
    const leftScore =
      (leftMatch.documentMatch ? 4 : 0) +
      (leftMatch.invoiceMatch ? 2 : 0) +
      ([left.Invoice, left.DocumentNum, left.Voucher].some((value) =>
        tokens.has(asText(value).toLowerCase()),
      )
        ? 1
        : 0);
    const rightScore =
      (rightMatch.documentMatch ? 4 : 0) +
      (rightMatch.invoiceMatch ? 2 : 0) +
      ([right.Invoice, right.DocumentNum, right.Voucher].some((value) =>
        tokens.has(asText(value).toLowerCase()),
      )
        ? 1
        : 0);
    return rightScore - leftScore;
  });
  const unique = [];
  const seen = new Set();
  for (const row of ranked) {
    const key = transKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function payloadFromInvoiceRow(candidate, journalLine, invoiceRow) {
  const settlementAmount = signedSettlementAmount(
    candidate.credit,
    candidate.debit,
  );
  const invoiceNumber =
    asText(invoiceRow.Invoice) ||
    asText(candidate.invoice) ||
    asText(invoiceRow.DocumentNum);
  return {
    JournalLineCompany: candidate.company,
    JournalBatchNumber: asText(journalLine.JournalBatchNumber),
    JournalLineNumber: candidate.lineNumber,
    InvoiceNumber: invoiceNumber,
    InvoiceCompany: candidate.company,
    InvoiceDueDate: invoiceRow.DueDate,
    SettlementAmountInInvoiceCurrency: settlementAmount,
    CashDiscountToTakeInInvoiceCurrency: 0,
  };
}

async function prepareSettlement(token, baseUrl, candidate, usedKeys) {
  let journalLine = candidate.journalLine;
  if (!journalLine) {
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
    journalLine = journalLines[0];
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
  }

  const settlementAmount = signedSettlementAmount(
    candidate.credit,
    candidate.debit,
  );
  if (!settlementAmount) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: settlement amount is zero`,
    );
  }

  const existingFromCandidate = candidate.existingSettlements;
  const journalBatchNumber = asText(journalLine.JournalBatchNumber);
  const duplicateFilter = [
    `JournalLineCompany eq ${odataLiteral(candidate.company)}`,
    `JournalBatchNumber eq ${odataLiteral(journalBatchNumber)}`,
    `JournalLineNumber eq ${candidate.lineNumber}`,
  ].join(' and ');
  const existing =
    existingFromCandidate ||
    (await odataGet(token, baseUrl, 'VendorPaymentJournalLineSettledInvoices', {
      'cross-company': 'true',
      $filter: duplicateFilter,
      $top: '5',
    }));

  if (existing.length > 0 && !candidate.forceRetryMarked) {
    const existingRow = existing[0];
    const payload = {
      JournalLineCompany: candidate.company,
      JournalBatchNumber: journalBatchNumber,
      JournalLineNumber: candidate.lineNumber,
      InvoiceNumber: asText(existingRow.InvoiceNumber) || asText(candidate.invoice),
      InvoiceCompany: candidate.company,
      InvoiceDueDate: existingRow.InvoiceDueDate,
      SettlementAmountInInvoiceCurrency: settlementAmount,
      CashDiscountToTakeInInvoiceCurrency: 0,
    };
    return {
      candidate,
      journalLine,
      invoiceRow: {
        Invoice: payload.InvoiceNumber,
        DueDate: payload.InvoiceDueDate,
      },
      invoiceRows: [],
      existing,
      payload,
    };
  }

  const openInvoices = await findOpenInvoiceRows(
    token,
    baseUrl,
    candidate,
    usedKeys,
  );
  if (openInvoices.length === 0 && existing.length === 0) {
    throw new Error(
      `Excel row ${candidate.rowNumber}: no open vendor transaction matched vendor ${candidate.vendorAccount}, invoice ${candidate.invoice || '(none)'}, amount ${Math.abs(settlementAmount)} ${candidate.currency}`,
    );
  }
  const invoiceRow = openInvoices[0] || {
    Invoice: asText(existing[0]?.InvoiceNumber),
    DocumentNum: '',
    DueDate: existing[0]?.InvoiceDueDate,
    AmountCur: settlementAmount,
    SettleAmountCur: 0,
  };
  const payload = payloadFromInvoiceRow(candidate, journalLine, invoiceRow);
  return {
    candidate,
    journalLine,
    invoiceRow,
    invoiceRows: openInvoices,
    existing,
    payload,
  };
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
        sourceExcelRow: plan.candidate.sourceExcelRow || null,
        sourceUniqueId: plan.candidate.sourceUniqueId || '',
        sourceInvoice: plan.candidate.invoice || '',
        sourceDocument: plan.candidate.sourceDocument || '',
        invoiceNumber: plan.payload.InvoiceNumber,
        invoiceDueDate: plan.payload.InvoiceDueDate,
        settlementAmount: plan.payload.SettlementAmountInInvoiceCurrency,
        currency: plan.candidate.currency,
        alreadyMarked: Boolean(plan.candidate.alreadyMarked),
        settleVoucher: plan.candidate.settleVoucher || '',
      },
      null,
      2,
    ),
  );
}

async function postAndVerify(token, baseUrl, plan, usedKeys) {
  if (plan.existing.length > 0 && !plan.candidate.forceRetryMarked) {
    printPlan(plan, 'already_marked');
    return 'already_marked';
  }

  const invoiceRows =
    plan.invoiceRows?.length > 0 ? plan.invoiceRows : [plan.invoiceRow];
  let lastError = '';
  for (const invoiceRow of invoiceRows) {
    const payload = payloadFromInvoiceRow(
      plan.candidate,
      plan.journalLine,
      invoiceRow,
    );
    if (!payload.InvoiceNumber || !payload.InvoiceDueDate) {
      lastError = 'Open transaction is missing invoice/document or due date';
      continue;
    }
    try {
      await d365Request(
        token,
        buildODataUrl(baseUrl, 'VendorPaymentJournalLineSettledInvoices'),
        { method: 'POST', body: JSON.stringify(payload) },
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (isAlreadyMarkedError(lastError)) {
        usedKeys?.add(transKey(invoiceRow));
        continue;
      }
      const recovered = await odataGet(
        token,
        baseUrl,
        'VendorPaymentJournalLineSettledInvoices',
        {
          'cross-company': 'true',
          $filter: [
            `JournalLineCompany eq ${odataLiteral(payload.JournalLineCompany)}`,
            `JournalBatchNumber eq ${odataLiteral(payload.JournalBatchNumber)}`,
            `JournalLineNumber eq ${payload.JournalLineNumber}`,
          ].join(' and '),
          $top: '2',
        },
      );
      if (recovered.length > 0) {
        plan.payload = payload;
        printPlan({ ...plan, payload }, 'already_marked');
        return 'already_marked';
      }
      throw error;
    }

    const verifyFilter = [
      `JournalLineCompany eq ${odataLiteral(payload.JournalLineCompany)}`,
      `JournalBatchNumber eq ${odataLiteral(payload.JournalBatchNumber)}`,
      `JournalLineNumber eq ${payload.JournalLineNumber}`,
      `InvoiceCompany eq ${odataLiteral(payload.InvoiceCompany)}`,
    ].join(' and ');
    const verified = await odataGet(
      token,
      baseUrl,
      'VendorPaymentJournalLineSettledInvoices',
      { 'cross-company': 'true', $filter: verifyFilter, $top: '5' },
    );
    const match = verified.find((row) =>
      moneyEquals(
        row.SettlementAmountInInvoiceCurrency,
        payload.SettlementAmountInInvoiceCurrency,
      ),
    );
    if (!match) {
      throw new Error(
        `POST completed but verification found ${verified.length} settlement rows`,
      );
    }
    usedKeys?.add(transKey(invoiceRow));
    plan.payload = payload;
    printPlan({ ...plan, payload }, 'marked_and_verified');
    return 'marked_and_verified';
  }
  throw new Error(lastError || 'No open vendor transaction could be marked');
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
      toPostmanDataRow({
        candidate: result.candidate,
        payload: result.payload,
      }),
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
    invalidCount: results.filter((result) => result.status === 'invalid')
      .length,
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
  const { sheetName, candidates } = options.journal
    ? await readJournalCandidates(token, baseUrl, options)
    : await readCandidates(options);
  if (options.sourceFile) {
    const sourceRows = await readSourceVendorRows(options.sourceFile);
    overlaySourceInvoices(candidates, sourceRows);
    console.log(
      `SourceFile=${path.basename(options.sourceFile)} SourceVendorRows=${sourceRows.length}`,
    );
  }
  if (candidates.length === 0)
    throw new Error('No vendor settlement candidates found');

  if (options.exportRequests) {
    console.log(
      `Workbook=${options.file ? path.basename(options.file) : options.journal} Sheet=${sheetName} Candidates=${candidates.length} Mode=GET_ONLY_EXPORT`,
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
    selected = candidates.filter(
      (candidate) => candidate.rowNumber === options.row,
    );
    if (selected.length !== 1) {
      throw new Error(`Excel row ${options.row} is not an Unmarked candidate`);
    }
  } else if (options.executeAll || options.journal) {
    selected = candidates;
  } else {
    throw new Error('Specify --row for a dry-run/test, or use --execute-all');
  }

  console.log(
    `${options.journal ? 'Journal' : 'Workbook'}=${options.journal || path.basename(options.file)} Sheet=${sheetName} Candidates=${candidates.length} Selected=${selected.length} IncludeMarked=${Boolean(options.includeMarked)}`,
  );

  let markedAndVerified = 0;
  let alreadyMarked = 0;
  let invalid = 0;
  let postFailed = 0;
  let skippedCustodyCredit = 0;
  let skippedNoInvoice = 0;
  const usedKeys = new Set();
  for (const candidate of selected) {
    if (options.sourceFile && isCustodyCreditCandidate(candidate)) {
      skippedCustodyCredit += 1;
      const existingInvoice = asText(
        candidate.existingSettlements?.[0]?.InvoiceNumber,
      );
      console.error(
        JSON.stringify({
          status: 'skipped_custody_credit',
          excelRow: candidate.rowNumber,
          voucher: candidate.voucher,
          vendorAccount: candidate.vendorAccount,
          uniqueId: asText(candidate.journalLine?.PaymentId),
          sourceExcelRow: candidate.sourceExcelRow || null,
          sourceInvoice: candidate.invoice || '',
          sourceDocument: candidate.sourceDocument || '',
          debit: candidate.debit,
          credit: candidate.credit,
          settleVoucher: candidate.settleVoucher || '',
          existingInvoice,
          message:
            `Journal line ${candidate.lineNumber} is a custody-holder credit on vendor ${candidate.vendorAccount}` +
            (candidate.invoice
              ? `; source INVOICE ${candidate.invoice} belongs to the vendor-invoice debit in UniqueId ${asText(candidate.journalLine?.PaymentId)}, not this credit account`
              : `; source has no vendor invoice for this credit`) +
            (candidate.sourceDocument
              ? `. Custody settlement uses DOCUMENT ${candidate.sourceDocument} / operation via X++, not VendorPaymentJournalLineSettledInvoices.InvoiceNumber`
              : '. OData invoice marking cannot post an empty InvoiceNumber for document/operation settlement') +
            (candidate.alreadyMarked && !existingInvoice
              ? '. D365 already has SettleVoucher=SelectedTransact with an empty InvoiceNumber from the X++ custody path'
              : candidate.alreadyMarked
                ? `. Already marked with InvoiceNumber=${existingInvoice}`
                : '. Left unmarked because this script only posts vendor-invoice settlements'),
        }),
      );
      continue;
    }
    if (
      options.sourceFile &&
      isPlaceholderInvoice(candidate.invoice) &&
      !asText(candidate.sourceDocument) &&
      !(candidate.existingSettlements || []).some((row) =>
        asText(row.InvoiceNumber),
      )
    ) {
      skippedNoInvoice += 1;
      console.error(
        JSON.stringify({
          status: 'skipped_no_source_invoice',
          excelRow: candidate.rowNumber,
          voucher: candidate.voucher,
          vendorAccount: candidate.vendorAccount,
          uniqueId: asText(candidate.journalLine?.PaymentId),
          sourceExcelRow: candidate.sourceExcelRow || null,
          debit: candidate.debit,
          credit: candidate.credit,
          message: `No usable INVOICE or DOCUMENT in source records for UniqueId ${asText(candidate.journalLine?.PaymentId)}, vendor ${candidate.vendorAccount}, journal line ${candidate.lineNumber}`,
        }),
      );
      continue;
    }
    if (
      options.includeMarked &&
      asText(candidate.settleVoucher) === 'None' &&
      (candidate.existingSettlements || []).length > 0 &&
      !isCustodyCreditCandidate(candidate)
    ) {
      candidate.forceRetryMarked = true;
    }
    let plan;
    try {
      plan = await prepareSettlement(token, baseUrl, candidate, usedKeys);
    } catch (error) {
      if (!options.executeAll && !options.journal) throw error;
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
      printPlan(
        plan,
        plan.existing.length ? 'already_marked' : 'dry_run_ready',
      );
      continue;
    }
    try {
      const status = await postAndVerify(token, baseUrl, plan, usedKeys);
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
        skippedCustodyCredit,
        skippedNoInvoice,
      }),
    );
    if (postFailed > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
