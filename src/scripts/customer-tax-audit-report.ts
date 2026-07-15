/**
 * Customer Master Data & Usage Audit Report
 * ==========================================
 * READ-ONLY script. Does NOT write, delete, or modify any data in MongoDB or D365FO.
 *
 * Run via:  pnpm customer-tax-audit
 *
 * Reads:
 *   - All customers from local MongoDB (source of truth for customer list)
 *   - Posted/open transactions, free-text invoices, sales orders, payment journal
 *     lines from D365FO OData API (bulk paginated, never per-customer)
 *
 * Generates:
 *   - .reports/customer-tax-audit-report.html
 *   - .reports/customer-tax-audit-report.xlsx
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import axios, { AxiosError } from 'axios';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';

// Use the native collection type returned by mongoose.Connection.db.collection().
type NativeCollection = ReturnType<
  NonNullable<mongoose.Connection['db']>['collection']
>;

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT = '.reports/customer-tax-audit-report.html';
const DEFAULT_OUTPUT_EXCEL = '.reports/customer-tax-audit-report.xlsx';
const PAGE_SIZE = 5000;

// ---------------------------------------------------------------------------
// Tax number normalisation & missing-detection
// (unchanged from existing audit logic)
// ---------------------------------------------------------------------------

/**
 * Normalisation: trim outer whitespace and collapse internal runs of whitespace
 * to a single space. Structural characters (dashes, dots, slashes) are preserved.
 */
function normaliseTaxNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Placeholder values that are treated as equivalent to "no tax number".
 * All comparisons are done on the lower-cased, trimmed value.
 */
const PLACEHOLDER_VALUES_LOWER = new Set(['n/a', 'na', '-', '--', '0']);

function isMissingTaxNumber(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const trimmed = raw.trim();
  if (trimmed === '') return true;
  if (PLACEHOLDER_VALUES_LOWER.has(trimmed.toLowerCase())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pct(num: number, den: number): string {
  if (den === 0) return '0%';
  return `${((num / den) * 100).toFixed(1)}%`;
}

function safeDate(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-GB');
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// D365FO auth (self-contained — no NestJS DI needed)
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _tokenCache: TokenCache | null = null;

interface D365FOCredentials {
  authority: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  resource: string;
}

async function getD365FOToken(creds: D365FOCredentials): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.accessToken;
  }

  const tokenUrl = `${creds.authority}/${creds.tenantId}/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    resource: creds.resource,
  });

  const response = await axios.post<{
    access_token: string;
    expires_in: number;
  }>(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
    family: 4,
  });

  _tokenCache = {
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  };
  return _tokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// OData paginator
// ---------------------------------------------------------------------------

interface ODataPageOptions {
  entitySet: string;
  filter: string;
  select: string[];
  top?: number;
}

interface DfoCheckStatus {
  entitySet: string;
  endpoint: string;
  status: 'Success' | 'Failed' | 'Skipped';
  recordsFetched: number;
  errorMessage?: string;
}

/**
 * Streaming paginator — fetches one D365FO page at a time, calls `onPage` with
 * just that page, then discards the page immediately. Never accumulates all rows
 * in memory. Returns total records streamed.
 */
async function streamODataPages<T>(
  creds: D365FOCredentials,
  options: ODataPageOptions,
  checkStatuses: DfoCheckStatus[],
  onPage: (
    records: T[],
    page: number,
    totalStreamed: number,
  ) => void | Promise<void>,
): Promise<number> {
  const { entitySet, filter, select, top = PAGE_SIZE } = options;
  let skip = 0;
  let page = 1;
  let totalStreamed = 0;

  const selectStr = encodeURIComponent(select.join(','));
  const filterStr = encodeURIComponent(filter);
  const baseEndpoint = `/data/${entitySet}`;

  console.info(`  [DFO] Streaming ${entitySet}...`);

  try {
    while (true) {
      const url =
        `${creds.resource}${baseEndpoint}` +
        `?cross-company=true` +
        `&$filter=${filterStr}` +
        `&$select=${selectStr}` +
        `&$top=${top}` +
        `&$skip=${skip}`;

      let pageRecords: T[] = [];

      // Retry — 3 attempts, exponential backoff
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const token = await getD365FOToken(creds);
          const resp = await axios.get<{ value: T[] }>(url, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 120_000,
          });
          pageRecords = resp.data?.value ?? [];
          break;
        } catch (err) {
          const axErr = err as AxiosError;
          const status = axErr.response?.status;
          if (
            attempt < 3 &&
            (status === 429 || (status ?? 0) >= 500 || !status)
          ) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(
              `  [DFO] ${entitySet} attempt ${attempt} failed (${status ?? 'network'}). Retrying in ${delay}ms…`,
            );
            await new Promise((r) => setTimeout(r, delay));
            if (status === 401) _tokenCache = null;
          } else {
            throw err;
          }
        }
      }

      totalStreamed += pageRecords.length;
      console.info(
        `  [DFO] ${entitySet} page ${page}: ${pageRecords.length} records streamed (total: ${totalStreamed})`,
      );

      // Aggregate into caller's data structure — page array is discarded after this
      await onPage(pageRecords, page, totalStreamed);

      if (pageRecords.length < top) break;
      skip += top;
      page++;
    }

    checkStatuses.push({
      entitySet,
      endpoint: `${creds.resource}${baseEndpoint}`,
      status: 'Success',
      recordsFetched: totalStreamed,
    });
    console.info(
      `  [DFO] ${entitySet}: Done. Total streamed: ${fmt(totalStreamed)}`,
    );
    return totalStreamed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [DFO] ${entitySet} FAILED: ${msg}`);
    checkStatuses.push({
      entitySet,
      endpoint: `${creds.resource}${baseEndpoint}`,
      status: 'Failed',
      recordsFetched: totalStreamed,
      errorMessage: msg,
    });
    return totalStreamed;
  }
}

// ---------------------------------------------------------------------------
// D365FO usage map builders
// ---------------------------------------------------------------------------

/** Key used for all usage maps: `${dataAreaId}|${customerAccount}` */
function usageKey(dataAreaId: string, accountNum: string): string {
  return `${dataAreaId}|${accountNum}`;
}

// --- Posted transactions ---

interface PostedTxInfo {
  count: number;
  lastDate?: string;
}

async function buildPostedTransactionsMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
): Promise<Map<string, PostedTxInfo>> {
  const map = new Map<string, PostedTxInfo>();

  await streamODataPages<{
    dataAreaId: string;
    AccountNum: string;
    TransDate?: string;
  }>(
    creds,
    {
      entitySet: 'CustTransactions',
      filter: `dataAreaId eq '${company}'`,
      select: ['dataAreaId', 'AccountNum', 'TransDate'],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId || !r.AccountNum) continue;
        const key = usageKey(r.dataAreaId, r.AccountNum);
        const info = map.get(key) ?? { count: 0 };
        info.count++;
        if (r.TransDate && (!info.lastDate || r.TransDate > info.lastDate)) {
          info.lastDate = r.TransDate;
        }
        map.set(key, info);
      }
    },
  );

  console.info(`  [DFO] CustTransactions distinct customers: ${fmt(map.size)}`);
  return map;
}

// --- Open transactions ---

interface OpenTxInfo {
  count: number;
  amountMST: number;
  lastDate?: string;
}

async function buildOpenTransactionsMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
): Promise<Map<string, OpenTxInfo>> {
  const map = new Map<string, OpenTxInfo>();

  await streamODataPages<{
    dataAreaId: string;
    AccountNum: string;
    TransDate?: string;
    AmountMST?: number;
  }>(
    creds,
    {
      entitySet: 'CustTransOpens',
      filter: `dataAreaId eq '${company}'`,
      select: ['dataAreaId', 'AccountNum', 'TransDate', 'AmountMST'],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId || !r.AccountNum) continue;
        const key = usageKey(r.dataAreaId, r.AccountNum);
        const info = map.get(key) ?? { count: 0, amountMST: 0 };
        info.count++;
        if (typeof r.AmountMST === 'number') info.amountMST += r.AmountMST;
        if (r.TransDate && (!info.lastDate || r.TransDate > info.lastDate)) {
          info.lastDate = r.TransDate;
        }
        map.set(key, info);
      }
    },
  );

  console.info(`  [DFO] CustTransOpens distinct customers: ${fmt(map.size)}`);
  return map;
}

// --- Free-text invoices ---

interface FtiInfo {
  count: number;
  lastDate?: string;
}

async function buildFreeTextInvoiceMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
): Promise<Map<string, FtiInfo>> {
  const map = new Map<string, FtiInfo>();

  const addRef = (
    dataAreaId: string,
    account: string | undefined,
    date?: string,
  ) => {
    if (!account) return;
    const key = usageKey(dataAreaId, account);
    const info = map.get(key) ?? { count: 0 };
    info.count++;
    if (date && (!info.lastDate || date > info.lastDate)) info.lastDate = date;
    map.set(key, info);
  };

  await streamODataPages<{
    dataAreaId: string;
    CustomerAccount?: string;
    InvoiceAccount?: string;
    InvoiceDate?: string;
  }>(
    creds,
    {
      entitySet: 'FreeTextInvoiceHeaders',
      filter: `dataAreaId eq '${company}'`,
      select: [
        'dataAreaId',
        'CustomerAccount',
        'InvoiceAccount',
        'InvoiceDate',
      ],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId) continue;
        addRef(r.dataAreaId, r.CustomerAccount, r.InvoiceDate);
        if (r.InvoiceAccount && r.InvoiceAccount !== r.CustomerAccount) {
          addRef(r.dataAreaId, r.InvoiceAccount, r.InvoiceDate);
        }
      }
    },
  );

  console.info(
    `  [DFO] FreeTextInvoiceHeaders distinct customers: ${fmt(map.size)}`,
  );
  return map;
}

// --- Sales orders ---

interface SalesOrderInfo {
  count: number;
  sampleOrderNumber?: string;
}

async function buildSalesOrderMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
): Promise<Map<string, SalesOrderInfo>> {
  const map = new Map<string, SalesOrderInfo>();

  const addRef = (
    dataAreaId: string,
    account: string | undefined,
    orderNum?: string,
  ) => {
    if (!account) return;
    const key = usageKey(dataAreaId, account);
    const info = map.get(key) ?? { count: 0 };
    info.count++;
    if (!info.sampleOrderNumber && orderNum) info.sampleOrderNumber = orderNum;
    map.set(key, info);
  };

  await streamODataPages<{
    dataAreaId: string;
    SalesOrderNumber?: string;
    OrderingCustomerAccountNumber?: string;
    InvoiceCustomerAccountNumber?: string;
  }>(
    creds,
    {
      entitySet: 'SalesOrderHeadersV4',
      filter: `dataAreaId eq '${company}'`,
      select: [
        'dataAreaId',
        'SalesOrderNumber',
        'OrderingCustomerAccountNumber',
        'InvoiceCustomerAccountNumber',
      ],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId) continue;
        addRef(
          r.dataAreaId,
          r.OrderingCustomerAccountNumber,
          r.SalesOrderNumber,
        );
        if (
          r.InvoiceCustomerAccountNumber &&
          r.InvoiceCustomerAccountNumber !== r.OrderingCustomerAccountNumber
        ) {
          addRef(
            r.dataAreaId,
            r.InvoiceCustomerAccountNumber,
            r.SalesOrderNumber,
          );
        }
      }
    },
  );

  console.info(
    `  [DFO] SalesOrderHeadersV4 distinct customers: ${fmt(map.size)}`,
  );
  return map;
}

// --- Payment journal lines ---

interface PaymentJournalInfo {
  count: number;
  sampleJournalBatch?: string;
}

/**
 * Extracts a candidate customer account from AccountDisplayValue.
 * The value may be a plain account number or a composed display value.
 * We try an exact match against the known customer account Set first,
 * then fall back to splitting on common delimiters and testing tokens.
 */
function extractCustomerAccount(
  displayValue: string,
  knownAccounts: Set<string>,
  _dataAreaId: string,
): string | null {
  const v = displayValue.trim();
  if (!v) return null;
  // Exact match
  if (knownAccounts.has(v)) return v;
  // Try splitting on common D365FO composed-value delimiters
  for (const delim of ['|', '::', ' - ', '-', ' ']) {
    const parts = v
      .split(delim)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (knownAccounts.has(part)) return part;
    }
  }
  return null;
}

async function buildPaymentJournalMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
  knownAccounts: Set<string>,
): Promise<Map<string, PaymentJournalInfo>> {
  const map = new Map<string, PaymentJournalInfo>();

  await streamODataPages<{
    dataAreaId: string;
    JournalBatchNumber?: string;
    AccountDisplayValue?: string;
    AccountType?: string;
  }>(
    creds,
    {
      entitySet: 'CustomerPaymentJournalLines',
      filter: `dataAreaId eq '${company}'`,
      select: [
        'dataAreaId',
        'JournalBatchNumber',
        'AccountDisplayValue',
        'AccountType',
      ],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId) continue;
        // Filter to customer-type lines only
        if (
          r.AccountType !== undefined &&
          r.AccountType !== '' &&
          !['customer', 'cust', '1'].includes(r.AccountType.toLowerCase())
        ) {
          continue;
        }
        const account = extractCustomerAccount(
          r.AccountDisplayValue ?? '',
          knownAccounts,
          r.dataAreaId,
        );
        if (!account) continue;
        const key = usageKey(r.dataAreaId, account);
        const info = map.get(key) ?? { count: 0 };
        info.count++;
        if (!info.sampleJournalBatch && r.JournalBatchNumber) {
          info.sampleJournalBatch = r.JournalBatchNumber;
        }
        map.set(key, info);
      }
    },
  );

  console.info(
    `  [DFO] CustomerPaymentJournalLines distinct customers: ${fmt(map.size)}`,
  );
  return map;
}

// --- Customer active status from D365FO ---

interface CustomerStatusInfo {
  onHoldStatus?: string;
  isActive: boolean;
  statusAvailable: boolean;
}

async function buildCustomerStatusMap(
  creds: D365FOCredentials,
  company: string,
  checks: DfoCheckStatus[],
): Promise<Map<string, CustomerStatusInfo>> {
  const map = new Map<string, CustomerStatusInfo>();

  await streamODataPages<{
    dataAreaId: string;
    CustomerAccount: string;
    OnHoldStatus?: string;
  }>(
    creds,
    {
      entitySet: 'Customers',
      filter: `dataAreaId eq '${company}'`,
      select: ['dataAreaId', 'CustomerAccount', 'OnHoldStatus'],
    },
    checks,
    (records) => {
      for (const r of records) {
        if (!r.dataAreaId || !r.CustomerAccount) continue;
        const key = usageKey(r.dataAreaId, r.CustomerAccount);
        map.set(key, {
          onHoldStatus: r.OnHoldStatus,
          isActive: r.OnHoldStatus === 'No',
          statusAvailable: true,
        });
      }
    },
  );

  console.info(`  [DFO] Customers (status) loaded: ${fmt(map.size)}`);
  return map;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MongoCustomer {
  _id: string;
  company: string;
  customerAccount: string;
  name?: string;
  taxExemptNumber?: string;
  organizationNumber?: string;
  customerGroupId?: string;
}

interface DuplicateGroup {
  normalisedTaxNumber: string;
  customerCount: number;
  riskLevel: 'High' | 'Medium';
  customers: CustomerRow[];
}

interface CustomerRow {
  customerAccount: string;
  name: string;
  company: string;
  originalTaxNumber: string;
  normalisedTaxNumber: string;
  movementStatus: string;
  suggestedAction: string;
}

interface MissingRow {
  customerAccount: string;
  name: string;
  company: string;
  taxNumberStatus: string;
}

interface CustomerAuditRow {
  company: string;
  customerAccount: string;
  customerName: string;
  customerGroupId?: string;
  taxExemptNumber?: string;
  organizationNumber?: string;
  normalizedTaxNumber?: string;
  hasTaxNumber: boolean;
  duplicateTaxNumber: boolean;
  duplicateGroupSize: number;
  isActive: boolean;

  hasPostedTransactions: boolean;
  postedTransactionCount: number;
  lastPostedTransactionDate?: string;

  hasOpenTransactions: boolean;
  openTransactionCount: number;
  openAmountMSTTotal: number;
  lastOpenTransactionDate?: string;

  hasFreeTextInvoiceRefs: boolean;
  freeTextInvoiceCount: number;

  hasSalesOrderRefs: boolean;
  salesOrderCount: number;

  hasPaymentJournalRefs: boolean;
  paymentJournalLineCount: number;

  hasAnyVisibleUsage: boolean;
  usageDataComplete: boolean;
  usageStatus: string;
  recommendation: string;
}

interface AuditSummary {
  totalCustomers: number;
  activeCustomers: number;
  inactiveCustomers: number;
  customersWithTaxNumber: number;
  customersMissingTaxNumber: number;
  duplicateTaxNumberGroups: number;
  duplicateTaxNumberCustomers: number;
  customersWithPostedTransactions: number;
  customersWithOpenTransactions: number;
  customersWithAnyVisibleUsage: number;
  activeCustomersWithAnyVisibleUsage: number;
  activeCustomersWithoutVisibleUsage: number;
  inactiveCustomersWithTransactions: number;
  deletionCandidateCount: number;
  dfoUsageChecksSucceeded: number;
  dfoUsageChecksFailed: number;
  generatedAt: Date;
  companyFilter: string;
}

interface AuditResult {
  summary: AuditSummary;
  allRows: CustomerAuditRow[];
  missingRows: MissingRow[];
  duplicateGroups: DuplicateGroup[];
  dfoCheckStatuses: DfoCheckStatus[];
  dfoAvailable: boolean;
}

const MOVEMENT_UNKNOWN = 'Unknown — verify in D365FO';

// ---------------------------------------------------------------------------
// MongoDB: load all customers
// ---------------------------------------------------------------------------

async function loadMongoCustomers(
  collection: NativeCollection,
): Promise<MongoCustomer[]> {
  const docs = await collection
    .find(
      {},
      {
        projection: {
          company: 1,
          customerAccount: 1,
          name: 1,
          taxExemptNumber: 1,
          organizationNumber: 1,
          customerGroupId: 1,
        },
      },
    )
    .toArray();

  return docs.map((d) => ({
    _id: String(d._id),
    company: String(d.company ?? ''),
    customerAccount: String(d.customerAccount ?? ''),
    name: d.name ? String(d.name) : undefined,
    taxExemptNumber: d.taxExemptNumber ? String(d.taxExemptNumber) : undefined,
    organizationNumber: d.organizationNumber
      ? String(d.organizationNumber)
      : undefined,
    customerGroupId: d.customerGroupId ? String(d.customerGroupId) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Duplicate detection (cursor-based in-memory grouping)
// ---------------------------------------------------------------------------

function buildDuplicateGroups(customers: MongoCustomer[]): DuplicateGroup[] {
  const byNormalisedTax = new Map<string, MongoCustomer[]>();

  for (const c of customers) {
    const raw = c.taxExemptNumber;
    if (isMissingTaxNumber(raw)) continue;
    const normalised = normaliseTaxNumber(raw!);
    if (!byNormalisedTax.has(normalised)) byNormalisedTax.set(normalised, []);
    byNormalisedTax.get(normalised)!.push(c);
  }

  const groups: DuplicateGroup[] = [];

  for (const [normalisedTaxNumber, members] of byNormalisedTax) {
    if (members.length < 2) continue;
    members.sort((a, b) => {
      const c = a.company.localeCompare(b.company);
      return c !== 0 ? c : a.customerAccount.localeCompare(b.customerAccount);
    });
    const customerCount = members.length;
    const riskLevel: 'High' | 'Medium' = customerCount > 2 ? 'High' : 'Medium';
    groups.push({
      normalisedTaxNumber,
      customerCount,
      riskLevel,
      customers: members.map((c) => ({
        customerAccount: c.customerAccount,
        name: c.name ?? '—',
        company: c.company,
        originalTaxNumber: c.taxExemptNumber ?? '',
        normalisedTaxNumber,
        movementStatus: MOVEMENT_UNKNOWN,
        suggestedAction:
          'Finance review required — movement status unknown. Verify in D365FO before taking action.',
      })),
    });
  }

  groups.sort((a, b) =>
    b.customerCount !== a.customerCount
      ? b.customerCount - a.customerCount
      : a.normalisedTaxNumber.localeCompare(b.normalisedTaxNumber),
  );
  return groups;
}

// ---------------------------------------------------------------------------
// Missing tax number rows
// ---------------------------------------------------------------------------

function buildMissingRows(customers: MongoCustomer[]): MissingRow[] {
  return customers
    .filter((c) => isMissingTaxNumber(c.taxExemptNumber))
    .sort((a, b) => {
      const cmp = a.company.localeCompare(b.company);
      return cmp !== 0
        ? cmp
        : a.customerAccount.localeCompare(b.customerAccount);
    })
    .map((c) => {
      const raw = c.taxExemptNumber;
      let taxNumberStatus = 'null / not set';
      if (raw != null) {
        const trimmed = raw.trim();
        if (trimmed === '') {
          taxNumberStatus = 'empty string';
        } else if (PLACEHOLDER_VALUES_LOWER.has(trimmed.toLowerCase())) {
          taxNumberStatus = `placeholder value: "${trimmed}"`;
        } else {
          taxNumberStatus = 'whitespace only';
        }
      }
      return {
        customerAccount: c.customerAccount,
        name: c.name ?? '—',
        company: c.company,
        taxNumberStatus,
      };
    });
}

// ---------------------------------------------------------------------------
// Merge: build CustomerAuditRow[]
// ---------------------------------------------------------------------------

function mergeCustomers(
  customers: MongoCustomer[],
  duplicateGroups: DuplicateGroup[],
  postedTxMap: Map<string, PostedTxInfo>,
  openTxMap: Map<string, OpenTxInfo>,
  ftiMap: Map<string, FtiInfo>,
  salesOrderMap: Map<string, SalesOrderInfo>,
  paymentJournalMap: Map<string, PaymentJournalInfo>,
  customerStatusMap: Map<string, CustomerStatusInfo>,
  failedChecks: Set<string>, // entitySet names that failed
): CustomerAuditRow[] {
  // Build a Set of all duplicate customer keys for O(1) lookup
  const duplicateKeyToGroupSize = new Map<string, number>();
  for (const g of duplicateGroups) {
    for (const c of g.customers) {
      duplicateKeyToGroupSize.set(
        usageKey(c.company, c.customerAccount),
        g.customerCount,
      );
    }
  }

  const statusCheckFailed = failedChecks.has('Customers');

  return customers.map((c) => {
    const key = usageKey(c.company, c.customerAccount);

    const hasTaxNumber = !isMissingTaxNumber(c.taxExemptNumber);
    const normalizedTaxNum = hasTaxNumber
      ? normaliseTaxNumber(c.taxExemptNumber!)
      : undefined;
    const dupGroupSize = duplicateKeyToGroupSize.get(key) ?? 0;
    const isDuplicate = dupGroupSize > 0;

    // isActive from D365FO Customers endpoint (OnHoldStatus === 'No')
    // Falls back to true if the status check failed or record not found
    const statusInfo = customerStatusMap.get(key);
    const isActive = statusCheckFailed
      ? true // status unavailable — do not present as inactive
      : (statusInfo?.isActive ?? true);

    const posted = postedTxMap.get(key);
    const open = openTxMap.get(key);
    const fti = ftiMap.get(key);
    const so = salesOrderMap.get(key);
    const pj = paymentJournalMap.get(key);

    const hasPostedTransactions = (posted?.count ?? 0) > 0;
    const hasOpenTransactions = (open?.count ?? 0) > 0;
    const hasFreeTextInvoiceRefs = (fti?.count ?? 0) > 0;
    const hasSalesOrderRefs = (so?.count ?? 0) > 0;
    const hasPaymentJournalRefs = (pj?.count ?? 0) > 0;

    const hasAnyVisibleUsage =
      hasPostedTransactions ||
      hasOpenTransactions ||
      hasFreeTextInvoiceRefs ||
      hasSalesOrderRefs ||
      hasPaymentJournalRefs;

    // usageDataComplete = false if any of the usage checks that would
    // have caught this customer failed
    const usageDataComplete = failedChecks.size === 0;

    let usageStatus: string;
    if (hasOpenTransactions) {
      usageStatus = 'Used — Has open balance';
    } else if (hasPostedTransactions) {
      usageStatus = 'Used — Has posted transactions';
    } else if (
      hasFreeTextInvoiceRefs ||
      hasSalesOrderRefs ||
      hasPaymentJournalRefs
    ) {
      usageStatus = 'Referenced — Has documents or journals';
    } else {
      usageStatus = 'No visible usage';
    }

    let recommendation: string;
    if (!usageDataComplete) {
      recommendation =
        'Usage check incomplete. Do not use this row for deletion decision.';
    } else if (hasOpenTransactions) {
      recommendation = 'Do not delete or deactivate before settlement/clearing';
    } else if (hasPostedTransactions) {
      recommendation =
        'Do not delete. Can be put on hold if Finance confirms inactive';
    } else if (
      hasFreeTextInvoiceRefs ||
      hasSalesOrderRefs ||
      hasPaymentJournalRefs
    ) {
      recommendation = 'Review/cancel related documents before deletion';
    } else if (!hasTaxNumber) {
      recommendation =
        'Review master data. Missing tax number and no visible usage';
    } else {
      recommendation = 'Candidate for deletion, subject to D365FO validation';
    }

    return {
      company: c.company,
      customerAccount: c.customerAccount,
      customerName: c.name ?? '—',
      customerGroupId: c.customerGroupId,
      taxExemptNumber: c.taxExemptNumber,
      organizationNumber: c.organizationNumber,
      normalizedTaxNumber: normalizedTaxNum,
      hasTaxNumber,
      duplicateTaxNumber: isDuplicate,
      duplicateGroupSize: dupGroupSize,
      isActive,

      hasPostedTransactions,
      postedTransactionCount: posted?.count ?? 0,
      lastPostedTransactionDate: posted?.lastDate,

      hasOpenTransactions,
      openTransactionCount: open?.count ?? 0,
      openAmountMSTTotal: open?.amountMST ?? 0,
      lastOpenTransactionDate: open?.lastDate,

      hasFreeTextInvoiceRefs,
      freeTextInvoiceCount: fti?.count ?? 0,

      hasSalesOrderRefs,
      salesOrderCount: so?.count ?? 0,

      hasPaymentJournalRefs,
      paymentJournalLineCount: pj?.count ?? 0,

      hasAnyVisibleUsage,
      usageDataComplete,
      usageStatus,
      recommendation,
    };
  });
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  rows: CustomerAuditRow[],
  duplicateGroups: DuplicateGroup[],
  dfoCheckStatuses: DfoCheckStatus[],
  company: string,
): AuditSummary {
  const total = rows.length;
  const active = rows.filter((r) => r.isActive).length;
  const inactive = total - active;
  const withTax = rows.filter((r) => r.hasTaxNumber).length;
  const noTax = total - withTax;
  const withPosted = rows.filter((r) => r.hasPostedTransactions).length;
  const withOpen = rows.filter((r) => r.hasOpenTransactions).length;
  const withUsage = rows.filter((r) => r.hasAnyVisibleUsage).length;
  const activeWithUsage = rows.filter(
    (r) => r.isActive && r.hasAnyVisibleUsage,
  ).length;
  const activeNoUsage = rows.filter(
    (r) => r.isActive && !r.hasAnyVisibleUsage,
  ).length;
  const inactiveWithTx = rows.filter(
    (r) => !r.isActive && r.hasPostedTransactions,
  ).length;
  const deletionCands = rows.filter(
    (r) =>
      r.usageDataComplete && !r.hasAnyVisibleUsage && !r.hasOpenTransactions,
  ).length;
  const succeeded = dfoCheckStatuses.filter(
    (s) => s.status === 'Success',
  ).length;
  const failed = dfoCheckStatuses.filter((s) => s.status === 'Failed').length;
  const dupCustomers = duplicateGroups.reduce((s, g) => s + g.customerCount, 0);

  return {
    totalCustomers: total,
    activeCustomers: active,
    inactiveCustomers: inactive,
    customersWithTaxNumber: withTax,
    customersMissingTaxNumber: noTax,
    duplicateTaxNumberGroups: duplicateGroups.length,
    duplicateTaxNumberCustomers: dupCustomers,
    customersWithPostedTransactions: withPosted,
    customersWithOpenTransactions: withOpen,
    customersWithAnyVisibleUsage: withUsage,
    activeCustomersWithAnyVisibleUsage: activeWithUsage,
    activeCustomersWithoutVisibleUsage: activeNoUsage,
    inactiveCustomersWithTransactions: inactiveWithTx,
    deletionCandidateCount: deletionCands,
    dfoUsageChecksSucceeded: succeeded,
    dfoUsageChecksFailed: failed,
    generatedAt: new Date(),
    companyFilter: company,
  };
}

// ---------------------------------------------------------------------------
// HTML report builder
// ---------------------------------------------------------------------------

function h(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function statusBadge(
  status: string,
  success: string,
  warn: string,
  _danger: string,
): string {
  const cl =
    status === success
      ? 'badge-ok'
      : status === warn
        ? 'badge-warn'
        : 'badge-bad';
  return `<span class="badge ${cl}">${h(status)}</span>`;
}

function buildHtml(result: AuditResult): string {
  const {
    summary,
    allRows,
    missingRows,
    duplicateGroups,
    dfoCheckStatuses,
    dfoAvailable,
  } = result;
  const s = summary;
  const genDate = s.generatedAt.toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'medium',
  });

  const dfoWarning = !dfoAvailable
    ? `<div class="alert alert-danger">
        <strong>D365FO Unavailable:</strong> Usage checks could not be performed.
        The tax quality sections are still valid. Do not use usage-based data for deletion decisions.
       </div>`
    : s.dfoUsageChecksFailed > 0
      ? `<div class="alert alert-warn">
        <strong>Warning:</strong> ${s.dfoUsageChecksFailed} D365FO usage check(s) failed.
        Customers affected by failed checks are marked with "Usage check incomplete".
       </div>`
      : '';

  // Helper to render a data table with given columns and rows
  const table = (
    columns: string[],
    rows: string[][],
    emptyMsg = 'No records found.',
  ) => {
    if (rows.length === 0) {
      return `<p class="empty">${emptyMsg}</p>`;
    }
    const thead = columns.map((c) => `<th>${h(c)}</th>`).join('');
    const tbody = rows
      .map(
        (row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  };

  // Section 1 — Executive Summary KPI cards
  const kpiCard = (label: string, value: string | number, sub?: string) =>
    `<div class="kpi-card">
      <div class="kpi-value">${typeof value === 'number' ? fmt(value) : value}</div>
      <div class="kpi-label">${h(label)}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;

  const execSummary = `
    <div class="kpi-grid">
      ${kpiCard('Total Customers', s.totalCustomers)}
      ${kpiCard('With Tax Number', s.customersWithTaxNumber, pct(s.customersWithTaxNumber, s.totalCustomers))}
      ${kpiCard('Missing Tax Number', s.customersMissingTaxNumber, pct(s.customersMissingTaxNumber, s.totalCustomers))}
      ${kpiCard('Duplicate Tax Numbers', s.duplicateTaxNumberGroups)}
      ${kpiCard('With Posted Transactions', s.customersWithPostedTransactions, pct(s.customersWithPostedTransactions, s.totalCustomers))}
      ${kpiCard('With Open Balance', s.customersWithOpenTransactions, pct(s.customersWithOpenTransactions, s.totalCustomers))}
      ${kpiCard('Active — No Visible Usage', s.activeCustomersWithoutVisibleUsage, pct(s.activeCustomersWithoutVisibleUsage, s.totalCustomers))}
      ${kpiCard('Deletion Candidates', s.deletionCandidateCount, 'Subject to D365FO validation')}
    </div>`;

  // Section 5 — Missing Tax Numbers
  const missingTable = table(
    ['#', 'Company', 'Customer Account', 'Name', 'Tax Number Status'],
    missingRows.map((r, i) => [
      String(i + 1),
      h(r.company),
      h(r.customerAccount),
      h(r.name),
      h(r.taxNumberStatus),
    ]),
    'No customers with missing tax number.',
  );

  // Section 6 — Duplicate Tax Numbers
  const dupRows: string[][] = [];
  let dupRowNum = 0;
  for (const g of duplicateGroups) {
    for (const c of g.customers) {
      dupRowNum++;
      dupRows.push([
        String(dupRowNum),
        h(g.normalisedTaxNumber),
        `<span class="badge ${g.riskLevel === 'High' ? 'badge-bad' : 'badge-warn'}">${g.riskLevel}</span>`,
        String(g.customerCount),
        h(c.company),
        h(c.customerAccount),
        h(c.name),
        h(c.originalTaxNumber),
      ]);
    }
  }
  const dupTable = table(
    [
      '#',
      'Normalised Tax Number',
      'Risk',
      'Group Size',
      'Company',
      'Account',
      'Name',
      'Original Tax Number',
    ],
    dupRows,
    'No duplicate tax numbers found.',
  );

  // Section 7 — Active with transactions
  const activeTxRows = allRows
    .filter((r) => r.isActive && r.hasPostedTransactions)
    .sort((a, b) => b.postedTransactionCount - a.postedTransactionCount)
    .slice(0, 500); // Cap HTML at 500 for readability; Excel has all
  const activeTxTable = table(
    [
      'Company',
      'Account',
      'Name',
      'Posted Txs',
      'Last Posted Date',
      'Open Txs',
      'Open Balance',
      'Usage Status',
    ],
    activeTxRows.map((r) => [
      h(r.company),
      h(r.customerAccount),
      h(r.customerName),
      fmt(r.postedTransactionCount),
      safeDate(r.lastPostedTransactionDate),
      fmt(r.openTransactionCount),
      r.openAmountMSTTotal !== 0
        ? r.openAmountMSTTotal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })
        : '0.00',
      h(r.usageStatus),
    ]),
    'No active customers with transactions.',
  );

  // Section 8 — Active without visible usage
  const activeNoUsageRows = allRows
    .filter((r) => r.isActive && !r.hasAnyVisibleUsage)
    .sort((a, b) => a.customerAccount.localeCompare(b.customerAccount));
  const activeNoUsageTable = table(
    ['Company', 'Account', 'Name', 'Has Tax Number', 'Recommendation'],
    activeNoUsageRows.map((r) => [
      h(r.company),
      h(r.customerAccount),
      h(r.customerName),
      r.hasTaxNumber ? '✓' : '✗',
      h(r.recommendation),
    ]),
    'All active customers have visible usage.',
  );

  // Section 9 — Customers with open balance
  const openBalRows = allRows
    .filter((r) => r.hasOpenTransactions)
    .sort((a, b) => b.openAmountMSTTotal - a.openAmountMSTTotal);
  const openBalTable = table(
    [
      'Company',
      'Account',
      'Name',
      'Open Tx Count',
      'Open Balance (MST)',
      'Last Open Date',
      'Recommendation',
    ],
    openBalRows.map((r) => [
      h(r.company),
      h(r.customerAccount),
      h(r.customerName),
      fmt(r.openTransactionCount),
      r.openAmountMSTTotal.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      safeDate(r.lastOpenTransactionDate),
      h(r.recommendation),
    ]),
    'No customers with open balance.',
  );

  // Section 10 — DFO Usage Check Status
  const dfoStatusTable = table(
    ['Entity Set', 'Status', 'Records Fetched', 'Error'],
    dfoCheckStatuses.map((c) => [
      h(c.entitySet),
      statusBadge(c.status, 'Success', 'Skipped', 'Failed'),
      fmt(c.recordsFetched),
      h(c.errorMessage ?? '—'),
    ]),
    'No D365FO checks attempted.',
  );

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: #f4f6f9; }
    .container { max-width: 1300px; margin: 0 auto; padding: 24px; }
    .report-header { background: #1F3864; color: #fff; padding: 32px 40px; border-radius: 8px; margin-bottom: 24px; }
    .report-header h1 { font-size: 22pt; font-weight: 700; margin-bottom: 8px; }
    .report-meta { font-size: 9.5pt; opacity: 0.85; }
    .section { background: #fff; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .section h2 { font-size: 13pt; font-weight: 700; color: #1F3864; border-bottom: 2px solid #e8edf3; padding-bottom: 10px; margin-bottom: 16px; }
    .section h3 { font-size: 11pt; font-weight: 600; color: #2F5496; margin: 18px 0 10px; }
    .kpi-grid { display: flex; flex-wrap: wrap; gap: 12px; }
    .kpi-card { flex: 1 1 160px; background: #f0f4fb; border-radius: 6px; padding: 16px; min-width: 140px; border-left: 4px solid #2F5496; }
    .kpi-value { font-size: 20pt; font-weight: 700; color: #1F3864; }
    .kpi-label { font-size: 8.5pt; color: #555; margin-top: 4px; }
    .kpi-sub { font-size: 8pt; color: #888; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
    th { background: #1F3864; color: #fff; padding: 7px 10px; text-align: left; font-weight: 600; }
    td { padding: 5px 10px; border-bottom: 1px solid #eef0f3; vertical-align: middle; }
    tr:nth-child(even) td { background: #f5f7fb; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 7.5pt; font-weight: 600; }
    .badge-ok   { background: #e6f4ea; color: #1a7232; }
    .badge-warn { background: #fff3cd; color: #856404; }
    .badge-bad  { background: #fde8e8; color: #c00; }
    .alert { border-radius: 6px; padding: 14px 18px; margin-bottom: 16px; font-size: 9.5pt; }
    .alert-danger { background: #fde8e8; border-left: 4px solid #c00; color: #7a0000; }
    .alert-warn { background: #fff3cd; border-left: 4px solid #e6a817; color: #5a4000; }
    .empty { color: #888; font-style: italic; font-size: 9pt; padding: 8px 0; }
    .disclaimer { background: #fff8e8; border: 1px solid #f0c060; border-radius: 6px; padding: 14px 18px; font-size: 9pt; color: #5a4000; margin-bottom: 20px; }
    @media print {
      body { background: #fff; }
      .container { max-width: 100%; padding: 0; }
      .section { box-shadow: none; border: 1px solid #ccc; break-inside: avoid; }
      .report-header { background: #1F3864 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @page { size: A4; margin: 15mm; }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Customer Master Data &amp; Usage Audit Report</title>
  <style>${css}</style>
</head>
<body>
<div class="container">

  <div class="report-header">
    <h1>Customer Master Data &amp; Usage Audit Report</h1>
    <div class="report-meta">
      Company: <strong>${h(s.companyFilter)}</strong> &nbsp;|&nbsp;
      Generated: <strong>${h(genDate)}</strong> &nbsp;|&nbsp;
      Environment: <strong>${h(process.env.NODE_ENV ?? 'development')}</strong> &nbsp;|&nbsp;
      Prepared by: Middleware Development Team &nbsp;|&nbsp;
      Intended for: Finance Department
    </div>
  </div>

  <div class="disclaimer">
    <strong>Read-Only Report.</strong>
    This script does not modify, delete, or deactivate any customer or transaction data.
    All deletion and deactivation decisions require Finance confirmation and D365FO validation.
    "Candidate for deletion" means no visible usage was found by this report — it does not mean the record is safe to delete.
  </div>

  ${dfoWarning}

  <!-- 1. Executive Summary -->
  <div class="section">
    <h2>1. Executive Summary</h2>
    ${execSummary}
  </div>

  <!-- 2. Tax Number Quality -->
  <div class="section">
    <h2>2. Tax Number Quality</h2>
    <table>
      <thead><tr><th>Metric</th><th>Count</th><th>%</th></tr></thead>
      <tbody>
        <tr><td>Customers with valid tax number</td><td>${fmt(s.customersWithTaxNumber)}</td><td>${pct(s.customersWithTaxNumber, s.totalCustomers)}</td></tr>
        <tr><td>Customers missing tax number</td><td>${fmt(s.customersMissingTaxNumber)}</td><td>${pct(s.customersMissingTaxNumber, s.totalCustomers)}</td></tr>
        <tr><td>Duplicate tax number groups</td><td>${fmt(s.duplicateTaxNumberGroups)}</td><td>—</td></tr>
        <tr><td>Customers in duplicate groups</td><td>${fmt(s.duplicateTaxNumberCustomers)}</td><td>${pct(s.duplicateTaxNumberCustomers, s.totalCustomers)}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- 3. Customer Activity / Usage Summary -->
  <div class="section">
    <h2>3. Customer Activity &amp; Usage Summary</h2>
    <table>
      <thead><tr><th>Metric</th><th>Count</th><th>%</th></tr></thead>
      <tbody>
        <tr><td>Customers with posted transactions</td><td>${fmt(s.customersWithPostedTransactions)}</td><td>${pct(s.customersWithPostedTransactions, s.totalCustomers)}</td></tr>
        <tr><td>Customers with open balance</td><td>${fmt(s.customersWithOpenTransactions)}</td><td>${pct(s.customersWithOpenTransactions, s.totalCustomers)}</td></tr>
        <tr><td>Customers with any visible usage</td><td>${fmt(s.customersWithAnyVisibleUsage)}</td><td>${pct(s.customersWithAnyVisibleUsage, s.totalCustomers)}</td></tr>
        <tr><td>Active customers with any visible usage</td><td>${fmt(s.activeCustomersWithAnyVisibleUsage)}</td><td>${pct(s.activeCustomersWithAnyVisibleUsage, s.totalCustomers)}</td></tr>
        <tr><td>Active customers without visible usage</td><td>${fmt(s.activeCustomersWithoutVisibleUsage)}</td><td>${pct(s.activeCustomersWithoutVisibleUsage, s.totalCustomers)}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- 4. Deactivation & Deletion Candidate Summary -->
  <div class="section">
    <h2>4. Deactivation &amp; Deletion Candidate Summary</h2>
    <table>
      <thead><tr><th>Metric</th><th>Count</th></tr></thead>
      <tbody>
        <tr><td>Deletion candidates (no visible usage, no open balance)</td><td>${fmt(s.deletionCandidateCount)}</td></tr>
        <tr><td>Customers with open balance — do not delete</td><td>${fmt(s.customersWithOpenTransactions)}</td></tr>
        <tr><td>Customers with posted transactions — do not delete</td><td>${fmt(s.customersWithPostedTransactions)}</td></tr>
      </tbody>
    </table>
    <p style="margin-top:12px;font-size:8.5pt;color:#555;">
      Deletion candidates are subject to D365FO validation. This report does not perform validation.
      Finance must confirm before any action is taken.
    </p>
  </div>

  <!-- 5. Missing Tax Numbers -->
  <div class="section">
    <h2>5. Missing Tax Numbers (${fmt(missingRows.length)} customers)</h2>
    ${missingTable}
  </div>

  <!-- 6. Duplicate Tax Numbers -->
  <div class="section">
    <h2>6. Duplicate Tax Numbers (${fmt(duplicateGroups.length)} groups)</h2>
    ${dupTable}
  </div>

  <!-- 7. Active Customers With Transactions -->
  <div class="section">
    <h2>7. Active Customers With Transactions (top ${Math.min(500, activeTxRows.length)} of ${fmt(allRows.filter((r) => r.isActive && r.hasPostedTransactions).length)})</h2>
    <p style="font-size:8.5pt;color:#888;margin-bottom:8px;">Full list available in the Excel report.</p>
    ${activeTxTable}
  </div>

  <!-- 8. Active Customers Without Visible Usage -->
  <div class="section">
    <h2>8. Active Customers Without Visible Usage (${fmt(activeNoUsageRows.length)} customers)</h2>
    ${activeNoUsageTable}
  </div>

  <!-- 9. Customers With Open Balance -->
  <div class="section">
    <h2>9. Customers With Open Balance (${fmt(openBalRows.length)} customers)</h2>
    ${openBalTable}
  </div>

  <!-- 10. DFO Usage Check Status -->
  <div class="section">
    <h2>10. D365FO Usage Check Status</h2>
    ${dfoStatusTable}
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Excel report builder
// ---------------------------------------------------------------------------

function styleHeaderCell(cell: ExcelJS.Cell, value: string): void {
  cell.value = value;
  cell.font = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
    size: 10,
    name: 'Calibri',
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3864' },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = { bottom: { style: 'medium', color: { argb: 'FF8EA9C1' } } };
}

function styleDataCell(
  cell: ExcelJS.Cell,
  bgArgb: string,
  fontOverride?: Partial<ExcelJS.Font>,
): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
  cell.font = { size: 9, name: 'Calibri', ...fontOverride };
  cell.border = {
    bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    right: { style: 'hair', color: { argb: 'FFDDDDDD' } },
  };
  cell.alignment = { vertical: 'middle', wrapText: false };
}

function addBanner(ws: ExcelJS.Worksheet, text: string, cols: number): void {
  ws.mergeCells(1, 1, 1, cols);
  ws.getRow(1).height = 22;
  const inf = ws.getCell(1, 1);
  inf.value = text;
  inf.font = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
    size: 10,
    name: 'Calibri',
  };
  inf.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F5496' },
  };
  inf.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
}

function addHeaders(
  ws: ExcelJS.Worksheet,
  row: number,
  headers: string[],
): void {
  ws.getRow(row).height = 20;
  headers.forEach((h, i) => styleHeaderCell(ws.getCell(row, i + 1), h));
}

function addDataRows(
  ws: ExcelJS.Worksheet,
  data: (string | number | boolean | undefined)[],
  idx: number,
  bgOverride?: string,
): void {
  const bg = bgOverride ?? (idx % 2 === 0 ? 'FFF2F5FA' : 'FFFFFFFF');
  const r = ws.addRow(data);
  r.height = 16;
  r.eachCell({ includeEmpty: true }, (cell) => styleDataCell(cell, bg));
}

function setupSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: { key: string; width: number }[],
  headers: string[],
  bannerText: string,
  generatedStr: string,
  printTitle: string,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 2, activeCell: 'A3' }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:2',
    },
  });
  ws.headerFooter = {
    oddHeader: `&C&B&11${printTitle}`,
    oddFooter: `&LGenerated: ${generatedStr}&CConfidential — Finance Use Only&RPage &P of &N`,
  };
  ws.columns = cols;
  addBanner(ws, bannerText, cols.length);
  addHeaders(ws, 2, headers);
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: cols.length },
  };
  return ws;
}

async function buildExcel(result: AuditResult): Promise<Buffer> {
  const {
    summary: s,
    allRows,
    missingRows,
    duplicateGroups,
    dfoCheckStatuses,
  } = result;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Middleware Development Team';
  wb.created = s.generatedAt;
  wb.modified = s.generatedAt;

  const generatedStr = s.generatedAt.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ── Tab 1: Summary ──────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Summary', {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    ws.columns = [{ width: 52 }, { width: 18 }, { width: 12 }];
    addBanner(
      ws,
      `Customer Master Data & Usage Audit — ${s.companyFilter} — ${generatedStr}`,
      3,
    );
    ws.getRow(2).height = 18;
    ['Metric', 'Count', '%'].forEach((h, i) =>
      styleHeaderCell(ws.getCell(2, i + 1), h),
    );
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 3 } };

    const rows: [string, number, string][] = [
      ['Total customers', s.totalCustomers, '100%'],
      [
        'Active customers (all synced as active)',
        s.activeCustomers,
        pct(s.activeCustomers, s.totalCustomers),
      ],
      [
        'Customers with valid tax number',
        s.customersWithTaxNumber,
        pct(s.customersWithTaxNumber, s.totalCustomers),
      ],
      [
        'Customers missing tax number',
        s.customersMissingTaxNumber,
        pct(s.customersMissingTaxNumber, s.totalCustomers),
      ],
      ['Duplicate tax number groups', s.duplicateTaxNumberGroups, '—'],
      [
        'Customers in duplicate tax groups',
        s.duplicateTaxNumberCustomers,
        pct(s.duplicateTaxNumberCustomers, s.totalCustomers),
      ],
      [
        'Customers with posted transactions',
        s.customersWithPostedTransactions,
        pct(s.customersWithPostedTransactions, s.totalCustomers),
      ],
      [
        'Customers with open balance',
        s.customersWithOpenTransactions,
        pct(s.customersWithOpenTransactions, s.totalCustomers),
      ],
      [
        'Customers with any visible D365FO usage',
        s.customersWithAnyVisibleUsage,
        pct(s.customersWithAnyVisibleUsage, s.totalCustomers),
      ],
      [
        'Active customers with visible usage',
        s.activeCustomersWithAnyVisibleUsage,
        pct(s.activeCustomersWithAnyVisibleUsage, s.totalCustomers),
      ],
      [
        'Active customers without visible usage',
        s.activeCustomersWithoutVisibleUsage,
        pct(s.activeCustomersWithoutVisibleUsage, s.totalCustomers),
      ],
      [
        'Deletion candidates (subject to D365FO validation)',
        s.deletionCandidateCount,
        pct(s.deletionCandidateCount, s.totalCustomers),
      ],
      ['D365FO usage checks succeeded', s.dfoUsageChecksSucceeded, '—'],
      ['D365FO usage checks failed', s.dfoUsageChecksFailed, '—'],
    ];

    rows.forEach(([metric, count, percent], idx) => {
      const bg = idx % 2 === 0 ? 'FFF2F5FA' : 'FFFFFFFF';
      const r = ws.addRow([metric, count, percent]);
      r.height = 16;
      r.eachCell({ includeEmpty: true }, (cell, col) => {
        styleDataCell(cell, bg);
        if (col === 2) {
          cell.numFmt = '#,##0';
          cell.font = { size: 9, bold: true, name: 'Calibri' };
        }
      });
    });

    // Disclaimer
    ws.addRow([]);
    const dRow = ws.addRow([
      'READ-ONLY REPORT. This script does not modify, delete, or deactivate any data. All deletion decisions require Finance confirmation and D365FO validation.',
    ]);
    dRow.getCell(1).font = {
      italic: true,
      size: 8.5,
      color: { argb: 'FF666666' },
      name: 'Calibri',
    };
    ws.mergeCells(dRow.number, 1, dRow.number, 3);
  }

  // ── Tab 2: All Customers ────────────────────────────────────────────────
  {
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'group', width: 14 },
      { key: 'tax', width: 22 },
      { key: 'hasTax', width: 10 },
      { key: 'dupTax', width: 10 },
      { key: 'postedTx', width: 12 },
      { key: 'openTx', width: 12 },
      { key: 'openBal', width: 16 },
      { key: 'fti', width: 12 },
      { key: 'so', width: 12 },
      { key: 'pj', width: 12 },
      { key: 'usageStatus', width: 34 },
      { key: 'recommendation', width: 55 },
    ];
    const hdrs = [
      '#',
      'Company',
      'Customer Account',
      'Customer Name',
      'Group ID',
      'Tax Number',
      'Has Tax',
      'Duplicate Tax',
      'Posted Txs',
      'Open Txs',
      'Open Balance',
      'FT Invoices',
      'Sales Orders',
      'Payment Journals',
      'Usage Status',
      'Recommendation',
    ];
    const ws = setupSheet(
      wb,
      'All Customers',
      cols,
      hdrs,
      `All Customers  |  ${fmt(allRows.length)} records  |  Company: ${s.companyFilter}  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Master Data & Usage Audit — All Customers',
    );

    allRows.forEach((r, idx) => {
      const bg = idx % 2 === 0 ? 'FFF2F5FA' : 'FFFFFFFF';
      const row = ws.addRow([
        idx + 1,
        r.company,
        r.customerAccount,
        r.customerName,
        r.customerGroupId ?? '',
        r.taxExemptNumber ?? '',
        r.hasTaxNumber ? 'Yes' : 'No',
        r.duplicateTaxNumber ? 'Yes' : 'No',
        r.postedTransactionCount,
        r.openTransactionCount,
        r.openAmountMSTTotal,
        r.freeTextInvoiceCount,
        r.salesOrderCount,
        r.paymentJournalLineCount,
        r.usageStatus,
        r.recommendation,
      ]);
      row.height = 16;
      row.eachCell({ includeEmpty: true }, (cell) => styleDataCell(cell, bg));
      row.getCell(11).numFmt = '#,##0.00';
    });
  }

  // ── Tab 3: Missing Tax Numbers ──────────────────────────────────────────
  {
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'status', width: 26 },
      { key: 'action', width: 52 },
    ];
    const ws = setupSheet(
      wb,
      'Missing Tax Numbers',
      cols,
      [
        '#',
        'Company',
        'Customer Account',
        'Customer Name',
        'Tax Number Status',
        'Suggested Action',
      ],
      `Missing Tax Numbers  |  ${fmt(missingRows.length)} customers  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Tax Audit — Missing Tax Numbers',
    );

    if (missingRows.length === 0) {
      const r = ws.addRow(['', '', 'No customers with missing tax number.']);
      r.getCell(3).font = {
        italic: true,
        color: { argb: 'FF666666' },
        size: 10,
        name: 'Calibri',
      };
    } else {
      missingRows.forEach((row, idx) => {
        addDataRows(
          ws,
          [
            idx + 1,
            row.company,
            row.customerAccount,
            row.name === '—' ? '' : row.name,
            row.taxNumberStatus,
            'Finance must provide or confirm tax number.',
          ],
          idx,
        );
      });
    }
  }

  // ── Tab 4: Duplicate Tax Numbers ────────────────────────────────────────
  {
    const cols = [
      { key: 'no', width: 6 },
      { key: 'normTax', width: 24 },
      { key: 'risk', width: 12 },
      { key: 'groupCount', width: 16 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'origTax', width: 24 },
      { key: 'action', width: 55 },
    ];
    const ws = setupSheet(
      wb,
      'Duplicate Tax Numbers',
      cols,
      [
        '#',
        'Normalised Tax Number',
        'Risk Level',
        'Customers in Group',
        'Company',
        'Customer Account',
        'Customer Name',
        'Original Tax Number',
        'Suggested Action',
      ],
      `Duplicate Tax Numbers  |  ${fmt(duplicateGroups.length)} groups  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Tax Audit — Duplicate Tax Numbers',
    );

    if (duplicateGroups.length === 0) {
      const r = ws.addRow(['', 'No duplicate tax numbers found.']);
      r.getCell(2).font = {
        italic: true,
        color: { argb: 'FF666666' },
        size: 10,
        name: 'Calibri',
      };
    } else {
      let rowNum = 0;
      duplicateGroups.forEach((g) => {
        const isHigh = g.riskLevel === 'High';
        const bgOdd = isHigh ? 'FFFFF5F5' : 'FFFFFBF0';
        const bgEven = isHigh ? 'FFFFE8E8' : 'FFFFF3DC';
        g.customers.forEach((c, cidx) => {
          rowNum++;
          const bg = rowNum % 2 === 0 ? bgEven : bgOdd;
          const row = ws.addRow([
            rowNum,
            g.normalisedTaxNumber,
            g.riskLevel,
            g.customerCount,
            c.company,
            c.customerAccount,
            c.name === '—' ? '' : c.name,
            c.originalTaxNumber,
            c.suggestedAction,
          ]);
          row.height = 16;
          row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
            styleDataCell(cell, bg);
            if (cidx === 0) {
              cell.border = {
                top: { style: 'thin', color: { argb: 'FF8EA9C1' } },
                bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
                right: { style: 'hair', color: { argb: 'FFDDDDDD' } },
              };
            }
            if (colIdx === 3) {
              cell.font = {
                size: 9,
                bold: true,
                name: 'Calibri',
                color: { argb: isHigh ? 'FFC00000' : 'FFBF8000' },
              };
            }
          });
        });
      });
    }
  }

  // ── Tab 5: Active With Transactions ─────────────────────────────────────
  {
    const activeTxRows = allRows.filter(
      (r) => r.isActive && r.hasPostedTransactions,
    );
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'postedTx', width: 14 },
      { key: 'lastDate', width: 16 },
      { key: 'openTx', width: 12 },
      { key: 'openBal', width: 18 },
      { key: 'usageSt', width: 34 },
      { key: 'rec', width: 55 },
    ];
    const ws = setupSheet(
      wb,
      'Active With Transactions',
      cols,
      [
        '#',
        'Company',
        'Account',
        'Name',
        'Posted Txs',
        'Last Posted Date',
        'Open Txs',
        'Open Balance',
        'Usage Status',
        'Recommendation',
      ],
      `Active Customers With Transactions  |  ${fmt(activeTxRows.length)} customers  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Audit — Active With Transactions',
    );
    activeTxRows
      .sort((a, b) => b.postedTransactionCount - a.postedTransactionCount)
      .forEach((r, idx) => {
        const row = ws.addRow([
          idx + 1,
          r.company,
          r.customerAccount,
          r.customerName,
          r.postedTransactionCount,
          safeDate(r.lastPostedTransactionDate),
          r.openTransactionCount,
          r.openAmountMSTTotal,
          r.usageStatus,
          r.recommendation,
        ]);
        row.height = 16;
        const bg = idx % 2 === 0 ? 'FFF2F5FA' : 'FFFFFFFF';
        row.eachCell({ includeEmpty: true }, (cell) => styleDataCell(cell, bg));
        row.getCell(8).numFmt = '#,##0.00';
      });
  }

  // ── Tab 6: Active Without Visible Usage ─────────────────────────────────
  {
    const noUsageRows = allRows.filter(
      (r) => r.isActive && !r.hasAnyVisibleUsage,
    );
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'hasTax', width: 10 },
      { key: 'group', width: 14 },
      { key: 'rec', width: 55 },
    ];
    const ws = setupSheet(
      wb,
      'Active Without Visible Usage',
      cols,
      [
        '#',
        'Company',
        'Account',
        'Name',
        'Has Tax',
        'Group ID',
        'Recommendation',
      ],
      `Active Customers Without Visible Usage  |  ${fmt(noUsageRows.length)} customers  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Audit — Active Without Visible Usage',
    );
    noUsageRows
      .sort((a, b) => a.customerAccount.localeCompare(b.customerAccount))
      .forEach((r, idx) => {
        addDataRows(
          ws,
          [
            idx + 1,
            r.company,
            r.customerAccount,
            r.customerName,
            r.hasTaxNumber ? 'Yes' : 'No',
            r.customerGroupId ?? '',
            r.recommendation,
          ],
          idx,
        );
      });
  }

  // ── Tab 7: Customers With Open Balance ──────────────────────────────────
  {
    const openRows = allRows.filter((r) => r.hasOpenTransactions);
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'openTx', width: 14 },
      { key: 'openBal', width: 20 },
      { key: 'lastDate', width: 16 },
      { key: 'rec', width: 55 },
    ];
    const ws = setupSheet(
      wb,
      'Customers With Open Balance',
      cols,
      [
        '#',
        'Company',
        'Account',
        'Name',
        'Open Tx Count',
        'Open Balance (MST)',
        'Last Open Date',
        'Recommendation',
      ],
      `Customers With Open Balance  |  ${fmt(openRows.length)} customers  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Audit — Open Balance',
    );
    openRows
      .sort((a, b) => b.openAmountMSTTotal - a.openAmountMSTTotal)
      .forEach((r, idx) => {
        const row = ws.addRow([
          idx + 1,
          r.company,
          r.customerAccount,
          r.customerName,
          r.openTransactionCount,
          r.openAmountMSTTotal,
          safeDate(r.lastOpenTransactionDate),
          r.recommendation,
        ]);
        row.height = 16;
        const bg = idx % 2 === 0 ? 'FFFFF5F5' : 'FFFDF0F0';
        row.eachCell({ includeEmpty: true }, (cell) => styleDataCell(cell, bg));
        row.getCell(6).numFmt = '#,##0.00';
      });
  }

  // ── Tab 8: Deletion Candidates ──────────────────────────────────────────
  {
    const deletionRows = allRows.filter(
      (r) =>
        r.usageDataComplete && !r.hasAnyVisibleUsage && !r.hasOpenTransactions,
    );
    const cols = [
      { key: 'no', width: 6 },
      { key: 'company', width: 12 },
      { key: 'account', width: 22 },
      { key: 'name', width: 36 },
      { key: 'hasTax', width: 10 },
      { key: 'tax', width: 22 },
      { key: 'complete', width: 16 },
      { key: 'rec', width: 55 },
    ];
    const ws = setupSheet(
      wb,
      'Deletion Candidates',
      cols,
      [
        '#',
        'Company',
        'Account',
        'Name',
        'Has Tax',
        'Tax Number',
        'Usage Data Complete',
        'Recommendation',
      ],
      `Deletion Candidates  |  ${fmt(deletionRows.length)} customers  |  Subject to D365FO validation  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Audit — Deletion Candidates',
    );
    deletionRows
      .sort((a, b) => a.customerAccount.localeCompare(b.customerAccount))
      .forEach((r, idx) => {
        addDataRows(
          ws,
          [
            idx + 1,
            r.company,
            r.customerAccount,
            r.customerName,
            r.hasTaxNumber ? 'Yes' : 'No',
            r.taxExemptNumber ?? '',
            r.usageDataComplete ? 'Yes' : 'No — check failed',
            r.recommendation,
          ],
          idx,
        );
      });
  }

  // ── Tab 9: DFO Usage Check Status ───────────────────────────────────────
  {
    const cols = [
      { key: 'entity', width: 36 },
      { key: 'endpoint', width: 70 },
      { key: 'status', width: 12 },
      { key: 'records', width: 16 },
      { key: 'error', width: 60 },
    ];
    const ws = setupSheet(
      wb,
      'DFO Usage Check Status',
      cols,
      ['Entity Set', 'Endpoint', 'Status', 'Records Fetched', 'Error Message'],
      `D365FO Usage Check Status  |  Generated: ${generatedStr}`,
      generatedStr,
      'Customer Audit — D365FO Check Status',
    );
    dfoCheckStatuses.forEach((c, idx) => {
      const isSuccess = c.status === 'Success';
      const bg = isSuccess
        ? idx % 2 === 0
          ? 'FFF2F5FA'
          : 'FFFFFFFF'
        : 'FFFFF0F0';
      const row = ws.addRow([
        c.entitySet,
        c.endpoint,
        c.status,
        c.recordsFetched,
        c.errorMessage ?? '',
      ]);
      row.height = 16;
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        styleDataCell(cell, bg);
        if (colIdx === 3) {
          cell.font = {
            size: 9,
            bold: true,
            name: 'Calibri',
            color: { argb: isSuccess ? 'FF1a7232' : 'FFC00000' },
          };
        }
      });
    });
  }

  const rawBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Load environment variables
  const environment = process.env.NODE_ENV ?? 'development';
  for (const envPath of [`.env.${environment}`, '.env.local', '.env']) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }

  const mongoUri = process.env.MONGODB_URI;
  const dfoRes = process.env.D365FO_RESOURCE ?? '';
  const dfoAuth = process.env.D365FO_AUTHORITY ?? '';
  const dfoTenant = process.env.D365FO_TENANT_ID ?? '';
  const dfoClient = process.env.D365FO_CLIENT_ID ?? '';
  const dfoSecret = process.env.D365FO_CLIENT_SECRET ?? '';
  const company = process.env.AUDIT_COMPANY ?? 'm-p';

  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not set.');
    process.exitCode = 1;
    return;
  }

  const dfoAvailable = !!(
    dfoRes &&
    dfoAuth &&
    dfoTenant &&
    dfoClient &&
    dfoSecret
  );
  const creds: D365FOCredentials = {
    authority: dfoAuth,
    tenantId: dfoTenant,
    clientId: dfoClient,
    clientSecret: dfoSecret,
    resource: dfoRes,
  };

  const outputPath = resolve(process.cwd(), DEFAULT_OUTPUT);
  const excelOutputPath = resolve(process.cwd(), DEFAULT_OUTPUT_EXCEL);

  console.info('Customer Master Data & Usage Audit');
  console.info('====================================');
  console.info(`Environment : ${environment}`);
  console.info(`Company     : ${company}`);
  console.info(
    `D365FO      : ${dfoAvailable ? 'Available' : 'NOT CONFIGURED — tax-only report will be generated'}`,
  );
  console.info(`HTML output : ${outputPath}`);
  console.info(`XLSX output : ${excelOutputPath}`);
  console.info('');

  // 2. Connect to MongoDB
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
    console.error('Error: MongoDB connection unavailable.');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const customersCollection = db.collection('customers');
  const dfoCheckStatuses: DfoCheckStatus[] = [];

  try {
    // 3. Load all customers from MongoDB
    console.info('Loading customers from MongoDB…');
    const mongoCustomers = await loadMongoCustomers(customersCollection);
    console.info(`  Customers loaded: ${fmt(mongoCustomers.length)}`);

    // Build Set of known customer accounts for payment journal lookup
    const knownAccounts = new Set(mongoCustomers.map((c) => c.customerAccount));

    // 4. Build tax audit structures (always, even without D365FO)
    const duplicateGroups = buildDuplicateGroups(mongoCustomers);
    const missingRows = buildMissingRows(mongoCustomers);

    // 5. Fetch D365FO usage data (streaming paginated — no row arrays kept in memory)
    let postedTxMap = new Map<string, PostedTxInfo>();
    let openTxMap = new Map<string, OpenTxInfo>();
    let ftiMap = new Map<string, FtiInfo>();
    let salesOrderMap = new Map<string, SalesOrderInfo>();
    let paymentJournalMap = new Map<string, PaymentJournalInfo>();
    let customerStatusMap = new Map<string, CustomerStatusInfo>();

    if (dfoAvailable) {
      console.info('');
      console.info(
        'Fetching D365FO usage data (streaming paginated, GET only)…',
      );
      console.info(`  Filter: dataAreaId eq '${company}'`);

      // Each fetcher streams one page at a time and aggregates into a Map.
      // No full transaction/entity arrays are kept in memory.
      postedTxMap = await buildPostedTransactionsMap(
        creds,
        company,
        dfoCheckStatuses,
      );
      openTxMap = await buildOpenTransactionsMap(
        creds,
        company,
        dfoCheckStatuses,
      );
      ftiMap = await buildFreeTextInvoiceMap(creds, company, dfoCheckStatuses);
      salesOrderMap = await buildSalesOrderMap(
        creds,
        company,
        dfoCheckStatuses,
      );
      paymentJournalMap = await buildPaymentJournalMap(
        creds,
        company,
        dfoCheckStatuses,
        knownAccounts,
      );
      customerStatusMap = await buildCustomerStatusMap(
        creds,
        company,
        dfoCheckStatuses,
      );
    } else {
      console.warn(
        '  D365FO credentials not configured. Skipping usage checks.',
      );
      [
        'CustTransactions',
        'CustTransOpens',
        'FreeTextInvoiceHeaders',
        'SalesOrderHeadersV4',
        'CustomerPaymentJournalLines',
        'Customers',
      ].forEach((e) => {
        dfoCheckStatuses.push({
          entitySet: e,
          endpoint: dfoRes ? `${dfoRes}/data/${e}` : 'N/A',
          status: 'Skipped',
          recordsFetched: 0,
          errorMessage: 'D365FO credentials not configured',
        });
      });
    }

    // 6. Merge customers + usage data
    const failedChecks = new Set(
      dfoCheckStatuses
        .filter((c) => c.status === 'Failed')
        .map((c) => c.entitySet),
    );
    const allRows = mergeCustomers(
      mongoCustomers,
      duplicateGroups,
      postedTxMap,
      openTxMap,
      ftiMap,
      salesOrderMap,
      paymentJournalMap,
      customerStatusMap,
      failedChecks,
    );

    // 7. Build summary
    const summary = buildSummary(
      allRows,
      duplicateGroups,
      dfoCheckStatuses,
      company,
    );

    const auditResult: AuditResult = {
      summary,
      allRows,
      missingRows,
      duplicateGroups,
      dfoCheckStatuses,
      dfoAvailable,
    };

    // 8. Generate HTML
    console.info('');
    console.info('Generating HTML report…');
    const html = buildHtml(auditResult);

    // 9. Generate Excel workbook
    console.info('Generating Excel workbook…');
    const excelBuffer = await buildExcel(auditResult);

    // 10. Write output files
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, 'utf8');
    await writeFile(excelOutputPath, excelBuffer);

    // 11. Console summary
    const s = summary;
    console.info('');
    console.info('Customer Master Data & Usage Audit completed.');
    console.info('');
    console.info(`Customers loaded from MongoDB: ${fmt(s.totalCustomers)}`);
    console.info('');
    console.info('DFO usage checks:');
    for (const c of dfoCheckStatuses) {
      const tag =
        c.status === 'Success'
          ? 'Success'
          : c.status === 'Skipped'
            ? 'Skipped'
            : 'FAILED';
      console.info(
        `  - ${c.entitySet}: ${tag}, records: ${fmt(c.recordsFetched)}${c.errorMessage ? ` (${c.errorMessage})` : ''}`,
      );
    }
    console.info('');
    console.info('Summary:');
    console.info(
      `  - Missing tax numbers           : ${fmt(s.customersMissingTaxNumber)}`,
    );
    console.info(
      `  - Duplicate tax number groups   : ${fmt(s.duplicateTaxNumberGroups)}`,
    );
    console.info(
      `  - Active customers              : ${fmt(s.activeCustomers)}`,
    );
    console.info(
      `  - Customers with posted tx      : ${fmt(s.customersWithPostedTransactions)}`,
    );
    console.info(
      `  - Customers with open balance   : ${fmt(s.customersWithOpenTransactions)}`,
    );
    console.info(
      `  - Active without visible usage  : ${fmt(s.activeCustomersWithoutVisibleUsage)}`,
    );
    console.info(
      `  - Deletion candidates           : ${fmt(s.deletionCandidateCount)}`,
    );
    console.info('');
    console.info('Reports generated:');
    console.info(`  - ${outputPath}`);
    console.info(`  - ${excelOutputPath}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Unhandled error:');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
