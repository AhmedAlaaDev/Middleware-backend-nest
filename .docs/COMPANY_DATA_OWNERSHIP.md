# Company data ownership and MAS isolation

Status: implementation notes for company selection (m-p and mas). Read with
`COMPANY_SELECTION.md`, which holds the request matrix and the open items.

## Principle

Each data source is classified by its D365FO ownership, not by what is convenient
to store. Shared data stays shared locally. A company only sees the shared values
that apply to it, and a company's own settings decide which shared values it uses.
Legacy rows whose owner is unknown belong to m-p only. Nothing is assigned to MAS
without evidence.

## Classification

| Data | D365FO ownership (evidence) | Local storage before | Decision and implementation |
|---|---|---|---|
| Ledger (currencies, exchange-rate type, chart of accounts) | Legal entity. `Ledgers` filtered by `LegalEntityId` | `ledgers.legalEntityId` | Company-specific already. Now the **source** of MAS run settings (`resolveCompanyRunConfig`). M-P keeps its legacy values. |
| Exchange rates (`ExchangeRates`) | Shared table, queried `crossCompany` with no company filter | `exchange_rates`, keyed by rate type | **Kept shared.** The company chooses its rate type from its ledger (`exchangeRateType`). Cash-Out lookups use that rate type too (previously a hard-coded `Default`). |
| Main accounts (`MainAccounts`) | Shared chart, filtered by `ChartOfAccounts` | `main_accounts`, keyed by chart | **Kept shared.** The company's chart comes from its ledger. Sync for `mas` reads the chart from the MAS ledger when no chart is given. |
| Financial dimension values (`LegalEntityId eq company or ''`) | Shared (`''`) or restricted to one legal entity | `financial_dimension_values`, unique on key and value only | **Now scoped.** Stored with `legalEntityId` (`''` shared, or the company). Lookups for a company return shared values plus its own. Legacy rows (no owner) are m-p only. |
| Account / customer-invoice mappings | Company configuration (mapping per legal entity) | `account_customer_invoice_mappings`, no company | **Now scoped.** `company` added to schema, API, DTOs and upsert key. Legacy rows are m-p only. Saves without company are stored as m-p, as before. |
| Customers, vendors, billing codes/classifications, payment terms, tax item group headings | Legal entity (queried with `company`) | Stored with company | Already company-scoped. No change. |
| Financial dimension names | Not company-specific in the queries used | Keyed by name | Shared. No change. |
| Sync jobs and status | Operational | Job `params.company` for exchange rates | Exchange-rate jobs record company. The status list is per dataset, not per company (open item). |
| D365 GET cache | Keyed by full OData URL (includes `dataAreaId` filter) | Redis/L1 | Company-scoped where the endpoint is. Shared endpoints stay shared. |
| Per-run processor caches (customer names, vendor names, dimensions, main accounts, exchange-rate index, billing codes) | Derived from the above | Instance fields on singleton processors | Reset before every company run under the processor lock (`runProcessorForCompany`). |
| Yard review jobs, MAS Revenue review snapshots | Operational | `company` on the job / review | Already stored per job. |
| Journal line idempotency (`listLinesForHeader`) | `dataAreaId` filter | D365 | Already company-scoped. |

## Hard-coded company assumptions that were removed

M-P's accounting rules were written as literals. For M-P the values are unchanged.
For every other company they now come from the company's ledger, and a missing
value stops the run with a precise configuration error.

| Location | Before | Now |
|---|---|---|
| Closing freight, trucking and freight-difference processors | `'EGP'` base, `'USD'` reporting | `this.accountingCurrency`, `this.reportingCurrency` from the run |
| Cash posting `resolveCashInExchangeRate` and Cash-Out line rate | EGP is always factor 100; missing rate becomes 100 | `accountingCurrencyQuotation`: M-P keeps 100 for EGP. Other companies stop on an accounting-currency line that has no verified factor. Cash-Out lines with no rate are rejected for non-M-P companies |
| Cash-In direct line builder | EGP is always 100 | Same quotation rule, passed from the processor |
| Cash-Out exchange-rate service | Base `EGP`, reporting `USD`, rate type `Default` | Parameters from the run; M-P passes the legacy values |

## Lock and identity review

- Every processing entry point that reads or mutates processor state now goes
  through `runProcessorForCompany`: AR, Cash, Vendor and Closing upload handlers,
  deferred import and reprocess in the data-batch service, and Yard submit.
  Not wrapped: the MAS Direct Revenue review service. It uses its own processor
  instance and its gates are unchanged (open item).
- The lock covers `reset`, `prepareCompanyRun` (ledger read), and the whole task.
  An exception in any step releases the lock (tested). Cancellation is not
  supported: a task that never settles keeps the lock for its processor type.
- The lock is in-process. It does not protect against two Node processes running
  the same processor type at once.

## Tests that pin this behaviour

- `src/modules/master-data/company-run-config.spec.ts`: legacy M-P values, MAS ledger
  required, named missing settings, accounting-currency quotation rule.
- `src/modules/entry-processor/company-scope/run-for-company.spec.ts`: overlapping
  M-P and MAS runs keep their own rate type, chart and currency; the M-P run after a
  MAS run restores legacy values; a failed MAS configuration releases the lock.
- `src/modules/cash/handlers/post-cash-batch-to-dfo.company-lifecycle.spec.ts`:
  PostToDFO takes the company from the saved batch; a client-supplied company is
  ignored; MAS EGP lines stop before any queue write; a missing MAS ledger never falls
  back to M-P; M-P result unchanged; identical IDs in two companies stay separate.
- `src/modules/master-data/repositories/account-customer-invoice-mapping.company-scope.spec.ts`:
  mapping reads and upserts per company, legacy rows are M-P only.
- `src/modules/cash/services/vendor-payment-settlement-company.spec.ts`: workbook
  company check.
- Client: `accounts-receivable/batch/-hooks/use-batch-form.company.test.tsx` (reset,
  no default, saved-batch company, disabled during submission),
  `services/api/data-batch.company.test.ts` (list query keys and parameters),
  `services/api/company-upload.test.ts` (multipart companyId, Yard endpoint parity).
