# Company selection: handover and request matrix

Scope: upload and processing for the two supported companies, `m-p` and `mas`.
Ownership analysis: `COMPANY_DATA_OWNERSHIP.md`. Nothing here is committed, deployed,
synced to live D365FO, or seeded with financial mappings.

## Request matrix (backend, under `/DataMigration` unless noted)

| Module | Route | companyId | Notes |
|---|---|---|---|
| AR | Freight-Document, Trucking-Document, Freight-CreditNote-Document, Trucking-CreditNote-Document, Yard-Document, Shipping-Lines-Document | Required, must be m-p or mas (ARFreightDto / ARTruckingDto) | Yard uses the same endpoint, processor and template for both companies |
| Cash | CashOut-Freight-Document, CashOut-Trucking-Document, CashIn-Freight-Document, CashIn-Trucking-Document, CashIn-Shiplink-Document, CashIn-Yard-Document | Optional. Missing -> m-p (legacy). Explicit values are validated and never replaced | Same handlers for both companies |
| Cash | CashIn-Yard-Invoice-Preview, CashIn-Shiplink-Invoice-Preview | Required (`requireCompanyCode`). The review job stores it | Preview runs in the background; submit uses the job's company |
| Cash | CashIn-Yard-Invoice-Jobs/:jobId/submit | No company field | Uses the company saved on the job |
| Vendor | Freight-Document, Freight-Document-Adjustment, Trucking-Document, Trucking-Document-Adjustment, Payment-Freight, Payment-Trucking | Optional, same legacy rule as Cash | |
| Ledger / closing | Freight-Closing-Entry, Freight-Closing-Difference, custody-settlement, Trucking-Closing-Entry | Required (ClosingEntryDto / ClosingFreightDifferenceDto) | |
| Ledger / Cash Management / AP | Uses the ledger upload routes above | As above | |
| All | PostToDFO | `batchId` only | Company comes from the saved batch. A client value is ignored (tested) |
| Admin | VendorPayment-Settlement-Document | Optional `companyId`. When given, every workbook row with a Company value must match. Omitted = legacy row-driven behaviour | No client UI exists for this route; API only |
| Admin | account-mappings GET / POST | GET `company` filter; POST `company` optional (legacy saves = m-p) | No client editor exists yet (see open items) |
| Admin | master-data sync endpoints | `company` required in the client; chart and rate type read from the company ledger when omitted (M-P keeps its legacy request) | |
| MAS only | CashIn-MAS-Revenue-* (Direct Revenue) | Must be `mas`; other values are rejected by the review service | Gates unchanged |

Client (`D365FOMiddleware_Client`): AR, Ledger, Cash In, Cash Out, Vendor, Cash
Management and Accounts Payable each show a required Company field with no default.
Batch lists have a Company filter and a company column. The master-data refresh
settings have a company selector and show whether each dataset is shared or
company-scoped.

## Changes in this round

- Shared currency and rate-type rules come from the company's ledger (`company-run-config.ts`).
  M-P keeps the legacy values exactly.
- Processor runs prepare the company's run settings under the lock (`prepareCompanyRun`).
- Closing processors, Cash posting, Cash-In direct builder and Cash-Out exchange lookups
  use those settings instead of EGP, USD and `Default`.
- Financial dimension values carry a legal-entity owner. Legacy rows are M-P only.
- Account/customer-invoice mappings carry a company in schema, DTOs, API, repository
  and upsert key. Legacy rows are M-P only.
- Settlement workbook company is checked against an optional selected company.
- Master-data sync resolves chart and rate type from the company ledger when omitted.

## MAS requirements (data and configuration, not code)

Each item stops MAS processing with an actionable error until it is done.

1. Sync the MAS Ledger row. It must have accounting currency, reporting currency,
   exchange-rate type and chart of accounts set in D365FO.
2. Sync exchange rates for the MAS exchange-rate type.
3. Sync main accounts for the MAS chart.
4. Sync MAS financial dimension values. The new sync writes an owner per value.
5. Sync MAS customers, vendors, billing codes/classifications, payment terms and tax
   item group headings.
6. Create MAS account/customer-invoice mappings through the API (`company: "mas"`).
   Nothing is seeded automatically.
7. Accounting-currency lines for MAS (when MAS's accounting currency is in use) need a
   verified quotation factor. None is configured, so those lines are blocked on purpose.
   Decide the factor in D365FO before lifting the block.
8. MAS Direct Revenue keeps its own verified configuration (cash accounts, tax groups,
   reporting rates, deployed compatibility flags).

## Legacy data

- Exchange rates, main accounts and financial dimension names are shared and were not
  changed.
- Financial dimension values and account mappings saved before this change have no owner.
  They are visible to M-P only. Re-running the M-P dimension sync adds owned rows, so
  duplicates can appear until the legacy rows are cleaned up. Do not run that sync for
  M-P without a decision on the cleanup.
- No data migration was performed.

## Open items

1. Client editor for account/customer-invoice mappings. None exists; creating one is a UI
   decision, so it was not built here. The API accepts `company` today.
2. Sync status is per dataset, not per company. Result summaries do not show the company
   for main-account jobs (the job stores only the chart).
3. The MAS Direct Revenue review service is not wrapped in the processor lock. It uses its
   own processor instance, and its gates were left unchanged.
4. The processor lock is in-process only. It has no cancellation or timeout: a task that
   never settles holds its processor type's lock.
5. Per-company audit of D365 endpoints that are not filtered by `dataAreaId` was not
   completed. Exchange rates are shared by design.
6. Settlement workbook company check: there is no client UI for this route.
7. Workbook company checks for upload templates: none of the upload templates has a
   recognised Company column, so none was added. The MAS Revenue company is a request
   field, not a column.
8. Mongo unique indexes for owned mappings and dimension values were not changed.
   Application-level upserts use the owner in the filter.

## Tests executed

- Backend Jest: 1288 passed, 6 failed (2 skipped). The 6 failures are in three suites
  (cash-in-optional-invoice, cash-out-enhancements.integration, vendor-payment.processor).
  Evidence that they reproduce on unchanged HEAD (`git archive HEAD`):
  `C:\Users\AHMEDA~1\AppData\Local\Temp\claude\64967d13f2b23147\60725d6b-7a27-4fac-9f49-97716f1c2402\scratchpad\head-baseline-evidence.txt`
  (6 failed, same test names).
- Backend tsc: only pre-existing errors (a `scratch/` file and typings in spec files
  that were already failing). The set of files with errors is identical to the baseline.
- Backend ESLint on the changed files: clean, except pre-existing issues in lines that were
  not changed (`String(value ?? '')` in the cash-out and post-handler services, and an
  unused injected field in a spec).
- Client: tsc clean; Vitest all passing; ESLint clean on changed files.

Limits: no live D365FO, no Mongo, and no browser were used. The lifecycle tests mock the
queue, the batch store and the ledger reads. The UI tests drive the form hooks with mocked
services; the Radix select is not clicked.

## Live operations still pending authorization

- Syncing any MAS dataset (ledger, exchange rates, main accounts, dimensions, customers,
  vendors, billing, tax).
- Creating any MAS account/customer-invoice mapping.
- Re-running the M-P financial dimension sync (adds owned rows next to legacy rows).
- Posting any MAS batch, and any D365 write.
- Deploying the backend or client.
