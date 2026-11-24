# MAS readiness verification

Scope: MAS company isolation through the processing lifecycle, with read-only D365FO
evidence from the sandbox and an isolated local stack. No D365FO writes, no posting, no
master-data sync, no deployment. Companion docs: `COMPANY_SELECTION.md`,
`COMPANY_DATA_OWNERSHIP.md`.

## 1. Identity and cache audit

Demonstrated gap fixed:
- Yard invoice settlement read back settled rows by journal batch number only
  (`PaymentJournalLineSettledInvoices`, cross-company). Journal batch numbers are not
  unique across legal entities, so the verification could count another company's
  settlements. The read now filters `JournalLineCompany eq '<company>'`. Test:
  `yard-invoice-settlement.company-scope.spec.ts`.

Checked and found company-safe (no change):
- Processor per-run caches: reset under the processor lock.
- Tax-group cache key includes company. D365 GET cache key is the full OData URL, which
  includes `dataAreaId` or `LegalEntityId` wherever the entity is company-specific.
- Journal line idempotency and settlement readback in customer/vendor journals filter
  by `dataAreaId` or `JournalLineCompany`.
- Yard enrichment uses `companyFilter: false` only for RecId-keyed lookups
  (GeneralJournalEntry, FinTag) and filters vouchers by `SubledgerVoucherDataAreaId`.
  RecIds are not company-specific, so this is intentional.
- Batch identity: batches are company-stamped; the queue job carries the saved batch
  company.

## 2. MAS Direct Revenue and the processor lock

Decision: the lock is not needed for MAS Direct Revenue.
- `CashInMasRevenueEntryProcessor.formatAndEnrichAsync` only sets `this.company` to
  the constant `mas`, creates local maps inside the call, and does not call warmup. Its
  `validateAsync` uses no instance state. There is no M-P state it could read or write.
- Its gates (configuration file, cash-account verifier, tax groups, reporting rate,
  deployed compatibility flags) are unchanged.

## 3. MAS ledger configuration (read-only, sandbox, 2026-11-24)

| Field | MAS (`LegalEntityId` 'MAS') | M-P (`LegalEntityId` 'M-P') |
|---|---|---|
| AccountingCurrency | EGP | EGP |
| ReportingCurrency | USD | USD |
| ExchangeRateType | **Average** | Default |
| ReportingCurrencyExchangeRateType | **blank** | Default |
| ChartOfAccounts | Chart of Accounts | Chart of Accounts |

Consequences:
- Transaction rates for MAS use `Average`. The M-P `Default` rates must not be used.
- MAS reporting rates have no configured rate type. The code now uses
  `ReportingCurrencyExchangeRateType` for reporting lookups, so reporting rates for MAS
  are reported as missing rather than borrowed from the transaction rate type.

## 4. Quotation factor (resolved from evidence)

MAS EGP accounting-currency factor = **100**.
Evidence: sandbox `LedgerJournalLines`, `dataAreaId=mas`, `CurrencyCode=EGP`, cross-company
read: 300 of 300 rows store `ExchRate=100`. The M-P EGP rows use the same factor.
Recorded in `VERIFIED_ACCOUNTING_QUOTATION_FACTORS` with this evidence. Other companies
and currencies stay blocked until a factor is read and recorded.

Reporting rate: not resolved. MAS EGP rows carry `ReportingCurrencyExchRate` values that
are inconsistent (some 0, the rest around 1.8 to 2.1). The reporting rate direction and
scale are not established, so MAS reporting-currency lines stay blocked.

## 5. Exchange-rate table (shared)

- `Average`: 64 rows in the sandbox. USD to EGP, for example 56.5 from 2026-11-01 with
  ConversionFactor `One`.
- `Default`: 307 rows.
- No EGP to USD rows were found for these rate types.
- The table is shared by design. Only the rate type is company-specific.

## 6. Master-data sync plan (exact)

Read-only counts from the sandbox (`$count`, `cross-company=true`). Middleware counts were
not read: the local database is empty and the live database was not accessed. Existing
usable data in the target database must be counted with the queries in section 8 before any sync.

| Dataset | Scope | Sandbox MAS | Sandbox M-P | D365 read endpoint | Middleware collection | Missing for MAS |
|---|---|---|---|---|---|---|
| Ledgers | Company | 1 (present) | 1 | `Ledgers?$filter=LegalEntityId eq 'mas'` | `ledgers` | Sync needed (not in local DB) |
| Exchange rates | Shared table, company rate type | 64 (`Average`) | 307 (`Default`) | `ExchangeRates?$filter=RateTypeName eq 'Average'` | `exchange_rates` | Sync `Average` only (not the whole table) |
| Main accounts | Shared chart (applicability per company) | 1,236 (`Chart of Accounts`) | same chart | `MainAccounts?$filter=ChartOfAccounts eq 'Chart of Accounts'` | `main_accounts` | Shared chart: sync only if absent locally |
| Financial dimension values | Shared or company-restricted (`LegalEntityId` '' or company) | 34 MAS-restricted, 2,434 MAS-or-shared | (M-P restricted, not counted) | `FinancialDimensionValues` with `LegalEntityId eq 'mas' or eq ''` | `financial_dimension_values` | Sync needed; writes `legalEntityId` owner |
| Customers | Company | **0** | 12,741 | `Customers?$filter=dataAreaId eq 'mas'` | `customers` | Customers for MAS are absent in D365 itself |
| Vendors | Company | 30 | 1,493 | `VendorsV3?$filter=dataAreaId eq 'mas'` | `vendors` | Sync needed (30 rows) |
| Payment terms | Company | 10 | - | `PaymentTerms?$filter=dataAreaId eq 'mas'` | `payment-terms` | Sync needed |
| Tax item group headings | Company | 4 | - | `TaxItemGroupHeadings` (dataAreaId) | `tax_item_group_headings` | Sync needed |
| Billing classifications / code versions / classification codes | Company | **0 / 0 / 0** | 3,737 classification codes (all companies) | `BillingClassifications`, `BillingCodeVersions`, `BillingClassificationCodes` (dataAreaId) | `billing_classifications`, `billing_code_versions`, `billing_codes` | Nothing to sync: MAS has no billing setup in D365. Billing-dependent uploads will fail for MAS |

Not in the sync plan:
- Bank accounts (4 for MAS) and cash accounts (4 for MAS). These are read by the
  cash-account verifier at run time. Their IDs were not read in this session.
- Tax groups and tax codes. Read earlier: NONTAXABLE and TAX groups. Tax 14 posting group
  has an empty payable account (blocker for VAT lines).

Order and validation after sync:
1. Ledgers (MAS): `exchangeRateType` = Average, chart set, currencies EGP and USD.
   Validation: the run configuration for MAS resolves (no CompanyConfigurationError).
2. Exchange rates `Average`: validation: USD to EGP rows present for the batch date.
3. Main accounts: validation: the revenue and offset accounts used by the upload exist in
   the chart.
4. Financial dimension values: validation: dimension lookups for MAS return shared plus MAS
   rows, and never M-P-only rows.
5. Vendors, payment terms, tax headings: validation: counts equal the sandbox counts above.
6. Customers and billing: no MAS sync is needed to validate, because D365 has none. Any
   MAS upload that needs customers or billing will fail until D365 is configured.

## 7. MAS business mappings still required (evidence-based candidates only)

| Mapping | Evidence | Status |
|---|---|---|
| Account/customer-invoice mappings (`account_customer_invoice_mappings`, serviceType 1 to 4) | None found in D365 for MAS | Required for AR/closing processors. No candidate exists. Do not copy M-P rows |
| Cash account for "Port Said" petty cash | MAS CashAccounts `Port Said` (from earlier sandbox evidence) | Candidate. Confirm the ID and the MAS RCash line usage before recording |
| Revenue accounts 415101 and 415701 | MAS chart evidence (earlier read) | Candidate for the Direct Revenue flow only. Mapping from revenue type "In" not decided |
| VAT / tax payable account | Tax 14 posting group `TAX TAX` has an empty payable account | **Missing.** Needs an accountant decision |
| Reporting rate type | MAS `ReportingCurrencyExchangeRateType` blank | **Missing.** Needs an accounting decision |
| JournalName for GL posting | `GL Journal` used by MAS GL journals (earlier read) | Candidate, unverified for the custom line service |

## 8. Read-only queries to run before any sync (target database)

Run these against the target database (not performed here, no live access):
- `db.ledgers.countDocuments({ legalEntityId: /^mas$/i })`
- `db.exchange_rates.countDocuments({ rateTypeName: /^average$/i })`
- `db.main_accounts.countDocuments({ chartNumber: 'Chart of Accounts' })`
- `db.financial_dimension_values.countDocuments({ legalEntityId: { $in: ['', 'mas'] } })`
- `db.customers.countDocuments({ company: 'mas' })`
- `db.vendors.countDocuments({ company: 'mas' })`
- `db.account_customer_invoice_mappings.countDocuments({ company: 'mas' })`

## 9. Browser and runtime verification

Environment: isolated stack on localhost only. MongoDB and Redis in throwaway containers
(`mas-check-mongo`, `mas-check-redis`). Backend on port 3100 with `SCHEDULER_ENABLED=false`.
Client dev server on port 5173 pointed at 3100. The 3001 container and production
settings were not touched. D365FO host: sandbox (`mesco.sandbox`).

| Check | Method | Result |
|---|---|---|
| Company selector shows MAS and M-P on the batch form | Browser | Pass |
| Changing company clears the uploaded file | Browser | Pass (file removed, Target Service kept) |
| Company and Target Service are independent (MAS + Yard Document) | Browser + API | Pass for selection. Review blocked (below) |
| MAS Yard review (`CashIn-Yard-Invoice-Preview`, companyId=mas) | API + Browser | **Blocked, as designed:** job `REVIEW_FAILED`, "No ledger is synced for company mas". No batch created, no M-P fallback |
| MAS AR Yard Document upload (`Yard-Document`, companyId=mas) | API | **Blocked:** HTTP 400 "No ledger is synced for company mas" |
| M-P Yard review (companyId=m-p) | API + Browser | Pass: job `PREVIEWED`, batch created with company m-p |
| M-P saved batch: company read-only, shown as Company M-P badge, Target Service Yard | Browser | Pass |
| Reopen M-P batch from its route | Browser | Pass (batch loaded with saved company) |
| `companyId=mas` in the request | Evidence: the saved job company is `mas` after browser submit | Pass (indirect). The multipart body was not inspected |
| Ordinary Yard endpoint, template and processor unchanged | Code review and API parity test (`company-upload.test.ts`) | Pass |
| MAS saved batch, queue, post, readback | Not reached: review blocked | Not verified |

Earlier browser mistake: a stale element reference selected MAS Revenue Cash In instead of
Yard Document during the first attempt. That was automation error, not an app change.
Target Service was corrected and the MAS revenue flow did not run.

## 10. Test classification

- **Mocked:** lifecycle posting tests (queue, batch store and ledger reads are mocked),
  repository filter tests, processor lock tests, quotation tests.
- **Database-backed (isolated MongoDB):** Yard review jobs, M-P batch save and reopen,
  MAS blocked job record. The data is test data created by the check.
- **Browser-tested (local UI):** selector, reset on company change, Yard Document
  selection, M-P upload to saved batch, reopen.
- **D365FO-tested:** read-only sandbox GETs only (Ledgers, LedgerJournalLines, ExchangeRates,
  counts). No D365 writes, no posting, no sync to D365FO.

## 11. Remaining required decisions

1. Authorize a local-only sync into the isolated `mas_check` database (ledger, `Average`
   exchange rates) so the MAS Yard review can run end to end. No D365 writes.
2. Decide the VAT payable account for MAS Tax 14 (accountant).
3. Decide the MAS reporting rate type and rate direction (accountant).
4. Decide whether MAS needs customers and billing setup in D365 before AR and billing
   uploads are used for MAS (business decision).
5. Provide the MAS account/customer-invoice mappings (business values, not inferred).

## 12. Update: local-only sync and rerun (2026-11-24, afternoon)

Local-only sync into the isolated `mas_check` database, through the application's own sync
endpoints (read from the D365 sandbox, written only to `mas_check`). The backend was confirmed to
read `mas_check` before the write (it returned the earlier test jobs). No D365 writes, no posting.

- `ledgers/sync?company=mas`: job `ledgers-mas-*` status `success`. Stored: 1 row,
  legalEntityId `mas`, accountingCurrency EGP, reportingCurrency USD, exchangeRateType `Average`,
  reportingCurrencyExchangeRateType blank, chartOfAccounts `Chart of Accounts`.
- `exchange-rates/sync?company=mas&rateType=Average`: job `exchange-rates-mas-Average-*` status
  `success`. Stored: 64 rows, rate type `Average`. Pairs: USD to EGP (13), EUR to USD (12),
  EUR to EGP (12), GBP to USD (13), GBP to EGP (14). No EGP to USD rows.

Rerun, company MAS, Target Service Yard Document, existing 8-column Yard template (blank
template, 0 data rows), through the browser:
- Request: `POST /api/v1/DataMigration/Cash/CashIn-Yard-Invoice-Preview`, the same route as M-P.
  The saved job company is `mas`, which shows the browser request carried `companyId=mas`.
- Result: job `PREVIEWED`, format `TEMPLATE_8`, 0 records. Batch `6b058cc2...` created with
  company `mas`, type 32 (the same type as the M-P Yard batch), status PendingPosting.
- Reopened from its route: Company MAS (mas) read-only, Target Service Yard Document, badge
  "Company: MAS (mas)", "Not posted to D365FO yet".

Limits of this run:
- The template has no data rows, so no customer, invoice, account or bank lookup ran for
  either company. Company-scoped lookup results were therefore not exercised.
- The real Yard source workbook (`IST_Yard.xlsx`) is rejected by the review route as too
  large (HTTP 413), and it is a source format, not the 8-column template.
- Earlier blocker: "No ledger is synced for company mas" was caused by the empty isolated database.
  It is resolved by the local sync above. It was not a code defect, and no M-P fallback occurred.

## 13. Non-empty Yard verification (2026-11-24, afternoon)

### Empty uploads (fixed)
- Cause: `runReview` stored the review and always called `createReviewBatch`. A workbook with zero
  records produced a batch with zero rows, which the cash-in path then placed in PendingPosting.
- Fix: a review with no transaction rows throws `No transaction rows found.`, so the job becomes
  `REVIEW_FAILED` and no batch is created. `createReviewBatch` also refuses an empty row set.
- Test: `yard-invoice-submit.service.spec.ts` ("empty uploads"). Live check: the blank template for
  M-P and MAS both return `REVIEW_FAILED` with that message and `batchId` null.

### HTTP 413 (layer identified, limit not raised)
- File: `IST_Yard.xlsx`, 13,746,874 bytes (13.1 MiB).
- Layer: the multipart middleware. The Yard preview routes use `FileInterceptor` with
  `limits.fileSize = YARD_INVOICE_LIMITS.maxFileBytes` = 10 MiB (10,485,760 bytes). The error is
  multer's "File too large", returned as 413.
- Not the cause: the JSON body limit (50 MB) does not apply to multipart. The AR Yard-Document route
  has no such limit and accepted the same file (it returned 400 for the missing ledger, not 413).
  The parser limits (2,000 data rows, 50 MB uncompressed) were not reached. No proxy is in the local stack.
- Not changed: the limit stays at 10 MiB.
- The source is also not a supported input for the review: its sheets (`Invoices_Report`, `PVT`,
  `Clients`) do not match the Yards source layouts the parser accepts.

### Test input
- Two 8-column files built from the existing template, with one row each, traceable to source
  row 8 (`Invoices_Report`, invoice 36746, date 2026-01-01, TOTAL 345 EGP, YARD SHIFTING):
  - `mas-check-input-mp.xlsx`: safe `AlexHO 11` (an M-P cash account in the sandbox).
  - `mas-check-input-mas.xlsx`: safe `Port Said` (a MAS cash account in the sandbox).
- Payment type `Cash`, reference `SRC ALX R8 36746` (the 35-character limit caught an earlier longer reference).
- Amount preserved as 345. Payment type, safe and reference are test choices, not source values.

### Invoice existence (the prerequisite)
- `000036746/YD` (FreeTextNumber) exists in M-P: found, but fully settled (AmountCur 345,
  SettleAmountCur 345), so the lookup returns `CLOSED`.
- The same number in MAS: `NOT_FOUND`. MAS has 0 `FreeTextInvoiceHeaders` (M-P has 249,041).
- All 40 candidate M-P invoices checked from the source were closed. The M-P test
  `000036770/YD` was also closed.
- Prerequisite: MAS needs posted, open free-text invoices. No invoice was created to pass the test.

### Exercised reviews
- MAS (browser, company MAS, target Yard Document): batch `6b0590d4c02101ad30d59c99`, company `mas`,
  PendingPosting, 1 error. Reopened through its route: company MAS read-only.
- MAS errors, root cause first:
  1. Yard: `NOT_FOUND`, no free-text invoice in the company.
  2. Yard: offset account (SAFE) not validated in D365.
  3. ReportingExchangeRate: `No valid reporting exchange rate for EGP to USD on 2026-01-01: the company ledger has no reporting exchange-rate type`. This is the reporting gate working as designed (blank `ReportingCurrencyExchangeRateType`).
  4. Dimension and account errors (`ActivityName`, `CostCenter`, `BusinessUnit`, `Location`,
     `Customer`, `SubCustomer`, `Direction`, dimension segment length, `AccountDisplayValue`,
     `OffsetAccountType`) follow from the missing invoice; no invoice metadata was resolved.
- M-P (same template, safe `AlexHO 11`): invoice found, `CLOSED`, so blocked. Batches were created
  for M-P as well (`6b058ff7...`, `6b05905c...`), by the same existing rule.

### Behaviour to decide
- A non-empty review in which every invoice is blocked still creates a PendingPosting batch (existing
  behaviour for both companies). The batch is not submittable, but it is visible in the list. The brief
  asked for batches only when validations pass; the brief also asked to preserve non-empty behaviour.
  This needs a decision before changing it.

### Evidence classification
- Company selection and persistence: verified (browser and API; the job and batch carry `mas`).
- Non-empty parsing: executed (1 record parsed for both inputs).
- Company-scoped lookups: executed (M-P found the invoice, MAS did not; no fallback).
- Amount, currency and reporting: amount 345 and currency EGP read back; reporting gate fired.
- Financial posting: untested. Nothing was submitted or enqueued. The "Post to D365FO" control was not clicked.

## 14. MAS Direct Revenue: invoice 1 from the customer workbook (2026-11-24)

Source: `outputs/mas-english/MAS_Direct_Revenue_English.xlsx`, sheet `Row Data`, row 2 (invoice 1).
Copied unchanged into `MAS_Direct_Revenue_Invoice1_Test.xlsx`; all other rows removed.
Fields: Date 2026-10-28, Invoice No `1`, Value 1600, VAT 224, Total 1824, TYPE 20DC, Description
GIVAUDAN EGYPT, VAT card 100497772, Container SEKU1165565, B/L HLCUIZ1260983630, Revenue type `In `
(trailing space kept), Sea line Habag Lloyd, cash account `خزينة بور سعيد مصري`.

Review: `POST /api/v1/DataMigration/Cash/CashIn-MAS-Revenue-Preview`, companyId=mas, templateVersion=1,
transactionCurrency=EGP, isolated mas_check. Review id `6b05963c7053ae9d8c9fdd2c`, status PREVIEWED,
canSubmit false, batchId null. No batch, submit, enqueue or D365 write.

1. Parser and normalizer: accepted. 1 transaction read, 1 accepted, 0 rejected, no issues.
   Totals EGP: value 1600.00, VAT 224.00, total 1824.00. Journal group `MASREV-202610-001`.
2. Configuration: blocked. The review's own blocker list (verbatim, 15 items):
   - GL JournalName is not configured.
   - Cash default dimensions are not set.
   - Cash financial tag is not set.
   - VAT rate is not configured.
   - VAT account is not configured.
   - Sales-tax group (TaxGroup) is not configured.
   - Item sales-tax group (TAXITEMGROUP) is not configured.
   - Tax-group combination not verified: confirm native tax adds no VAT on top of the explicit VAT line.
   - Reporting currency is not configured (MAS ledger ReportingCurrency is USD).
   - Reporting exchange-rate type is not configured (MAS ledger ReportingCurrencyExchangeRateType is blank).
   - Cash account `خزينة بور سعيد مصري` is not in the verified cash-account configuration. Bank accounts are not supported yet.
   - Revenue type `In` has no revenue account in configuration.
   - No verified exchange rates for EGP.
   - Cash-in line service not verified for RCash-to-Ledger on a GL journal in this environment.
   - GL journal readback not verified in this environment.
3. Financial submission: not attempted. Blocked by item 2 and by `canSubmit: false`.

Receipt identity (implemented locally, version 2; see `MAS_REVENUE_CASH_IN.md`, "Receipt identity").
The identity is company, the server namespace `MAS_DIRECT_REVENUE`, the transaction year from the
Date column, and the original invoice number. The invoice number is kept unchanged for display and
document fields. New PaymentIds are `MR<year>-<16 hex>` with `-REV`/`-VAT`, within a conservative
30-character limit. Legacy batches keep `MASREV-<invoice>` so their retries and readback still match.
Submit reserves each identity atomically through unique indexes on `mas_revenue_receipt_claims`.
A re-dated receipt with the same content is refused as `CORRECTION_REQUIRED`.

Section 14 remains a local result. Configuration readiness (the 15 blockers above) is unchanged: the
identity change does not open any gate, and financial submission is still not authorized.
Migration and backfill are planned in `MAS_REVENUE_IDENTITY_MIGRATION.md` and not run.
