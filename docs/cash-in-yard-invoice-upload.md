# Cash-In Yard invoice upload

Status: **review, background jobs, consolidation, D365 lookups and submit through the existing Cash-In Yard path are implemented behind a feature flag that is off by default. Nothing has been verified against live D365. Do not enable the flag outside a verified non-production environment.**

- Backend: `src/modules/cash/yard-invoice/`. Routes on `DataMigration/Cash`.
- Client: `src/routes/dashboard/cash-in/yard-invoice/`, `src/lib/yard-invoice-state.ts`, `src/services/api/yard-invoice.ts`.

## Configuration

| Side | Setting | Default | Effect |
|---|---|---|---|
| Backend | `YARD_INVOICE_UPLOAD_ENABLED` | off | `true`/`1`/`yes` enables the Yard routes. Off → 404. |
| Client | `VITE_YARD_INVOICE_UPLOAD_ENABLED` | off | `true` shows the link on Cash In and the page. |

The existing Yard, ShipLink, Cash-Out and vendor routes are unchanged.

## Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/DataMigration/Cash/CashIn-Yard-Invoice-Preview` | Start a background review. Creates a job in `REVIEWING`. Posts nothing. |
| GET | `/DataMigration/Cash/CashIn-Yard-Invoice-Jobs/:jobId` | Job state, review summary, batch state. |
| GET | `/DataMigration/Cash/CashIn-Yard-Invoice-Jobs/:jobId/invoices?page=&pageSize=` | One page of reviewed invoices (max 500 per page). |
| POST | `/DataMigration/Cash/CashIn-Yard-Invoice-Jobs/:jobId/submit` | Start a background submit. The same workbook is reviewed again on the server. |

All routes require an authenticated user. Only the uploader or an administrator can read or submit a job. The review and the submit run in the background because a large file takes minutes. The client polls the job until it settles.

## Two formats, told apart explicitly

The parser detects the format from the workbook, and the review states which one was used.

| | Eight-column template (`Yards-Shiplink-Template.xlsx`) | Yards source workbook (`Yards.xlsx`) |
|---|---|---|
| Detection | Exactly one sheet named `Template` with the eight headers in order | Every sheet's row-1 headers match one of three known layouts exactly |
| Serial | `PaymentSerial` (required, text) | None. `PAYMENTID` is left blank (see open items) |
| Reference | `PaymentReference` (≤ 35 characters) | `Payment Rmrk` (only on sheet `yard.`), ≤ 35 characters; not truncated |
| Customer, dimensions, tag | Resolved from D365 only | Carried in the workbook; **compared** with D365 and blocking on any difference |
| Rows | ≤ 2,000 | ≤ 25,000 across all sheets |
| Credit notes | Rejected by the parser | Kept and reported; the file cannot be submitted while any remain |
| Anything else | Refused with the list of accepted formats | Refused with the list of accepted formats |

Accepted Yards layouts (matched by exact header sequence, never fuzzily):

| Layout id | Headers in row 1 | Sheets in the supplied file |
|---|---|---|
| `YARDS_LAYOUT_IST` | Payment Date, Payment Type, Customer, Net Total, Currency, SAFE_BankAccount, FREETEXTNUMBER, DEFAULTDIMENSIONDISPLAYVALUE, HEADERFINTAGDISPLAYVALUE, CUSTOMERACCOUNT | `10-YARD-IST` |
| `YARDS_LAYOUT_CUR_SAFE` | Payment Date, Payment Type, Net Total, Cur, safe, FREETEXTNUMBER, DEFAULTDIMENSIONDISPLAYVALUE, HEADERFINTAGDISPLAYVALUE, CUSTOMERACCOUNT | `Atlantic`, `Eagle` |
| `YARDS_LAYOUT_REMARK` | Payment Date, Payment Type, Payment Rmrk, Net Total, Cur, SAFE, FREETEXTNUMBER, DEFAULTDIMENSIONDISPLAYVALUE, HEADERFINTAGDISPLAYVALUE, CUSTOMERACCOUNT | `yard.` |

## Yards source: field mapping (verified from the workbook)

| Common field | Source header(s) | Rule |
|---|---|---|
| sourceSheet, sourceRow | sheet name, 1-based row | Kept on every record |
| paymentDate | `Payment Date` | Text `dd-mm-yyyy` in all rows (verified: 2026-07-01 to 2026-11-01). Excel date cells also accepted |
| rawPaymentType → paymentType | `Payment Type` | Case-insensitive: `CASH`/`Cash` → Cash; `transfer` → Transfer; `CHECK` → Cheque; `deposit` → Deposit. Other values refused |
| amount | `Net Total` (number cells, exact) | Kept exact; negative only with the `-CN` suffix |
| currencyCode | `Currency` / `Cur` | Padding trimmed (`EGP       `); must equal the D365 invoice currency |
| safeBankAccount | `SAFE_BankAccount` / `safe` / `SAFE` | Trimmed; blank refused |
| invoiceNumber | `FREETEXTNUMBER` | Exact text. `-CN` suffix → credit note |
| paymentReference | `Payment Rmrk` (sheet `yard.` only) | Trimmed; > 35 characters refused, not truncated |
| workbookCustomerAccount | `CUSTOMERACCOUNT` | Compared with the D365 invoice customer |
| workbookCustomerName | `Customer` (sheet `10-YARD-IST` only) | Informational; the same account has several names in 13 cases |
| workbookDimension | `DEFAULTDIMENSIONDISPLAYVALUE` | Compared with the D365 default dimensions (trimmed on both sides) |
| workbookFinTag | `HEADERFINTAGDISPLAYVALUE` | Compared with the D365 tag display value (trimmed on both sides) |

Verified facts about the workbook: the customer segment of every dimension string equals `CUSTOMERACCOUNT` (19,666 of 19,666 rows). Invoice numbers are unique across all sheets and contain no leading or trailing spaces. Amounts carry up to four decimal places. The tag strings carry trailing padding.

## Consolidation, rounding and credit notes

- One group per exact invoice number. Rows with the same invoice are summed in exact decimal. In the supplied file every invoice appears once, so no grouping occurs there; the code path is covered by tests.
- Rows of one group must agree on currency, payment type, SAFE value, date and reference, and on the workbook customer, dimension and tag. A disagreement is an error. No first-row choice is made.
- Rounding: the total is rounded once to the currency's minor units (half away from zero). The review shows the raw total, the rounded total and the change.
- Credit notes (`-CN`) are never posted. A group containing one is an error, so the file cannot be submitted while any remain.

Measured on the supplied file (read-only, no D365):

| Measure | Value |
|---|---|
| Rows in workbook | 19,666 |
| Records accepted | 19,655 |
| Record issues | 11: 3 blank SAFE (2 of them on credit notes), 8 payment remarks > 35 characters (3 of these are the USD rows) |
| Invoice groups | 19,655 |
| Credit-note groups | 70 (blocking) |
| Rows whose amount changes at 2 decimals | 17,139 of 19,666 |
| Net rounding change, accepted records (EGP) | −1.3411 (the rejected rows would add −0.0037) |
| Largest single rounding change | 0.0050 (an exact half unit) |
| USD invoices | 0 accepted; all 3 rejected for remark length |

## Offset account (SAFE / bank)

Payment type → offset type and D365 entity (unchanged from the eight-column flow):

| Payment type | OFFSETACCOUNTTYPE | D365 entity | Checks |
|---|---|---|---|
| Cash | `Petty cash` | `CashAccounts` (key `Cash`) | Exists once; currency equals the payment currency |
| Cheque, Transfer, Deposit | `Bank` | `BankAccounts` (key `BankAccountId`) | Exists once; `BankAccountStatus` = active for all transactions; payment date inside `ActiveFrom`/`ActiveTo`; currency equals the payment currency |

The SAFE values in the file are names such as `Yard EG`, `CIB-EG-CA`, `QNB-EG-CA1`, `QNB-US-CA2`, `QNB-EG-OD` and `NBE-EG-CA`. Whether each is a D365 account id is **not verified**. The check runs in batch (one read per distinct account and payment type). An account that does not match is an error for every payment that uses it.

## D365 lookups (batched, read-only)

Every stage is company-scoped and reads up to 40 keys per request. Each key list is an OData `or` group wrapped in parentheses, so it binds before the company filter. Failed chunks mark only their invoices as retryable.

| Stage | Entity | Keys | Used for |
|---|---|---|---|
| 1 | `FreeTextInvoiceHeaders` | `FreeTextNumber` | Posted state, customer, currency, default dimensions |
| 2 | `CustTransBiEntities` | `Invoice` | Posted invoice transaction (positive `AmountCur` with a voucher), account, currency, closed state, open balance |
| 3 | `GeneralJournalEntryBiEntities` | `SubledgerVoucher` | GL entries of the voucher |
| 4 | `GeneralJournalAccountEntryBiEntities` | `GeneralJournalEntry` (Int64) | The posted receivable line (`PostingType` `CustBalance`, debit); its `FinTag` |
| 5 | `FinTagBiEntities` | `SourceKey` (Int64) | Tag display value |

Assumptions still to confirm on a posted non-production invoice: `CustTransBiEntities.Invoice` equals the free-text number; the receivable line carries the header tag; the enum comes back as `CustBalance` or `31`.

## Validation per invoice

Blocking errors: lookup not `FOUND`; currency mismatch; missing customer, dimensions or tag; total above the open balance plus 0.01 (the existing settlement tolerance); offset account not `OK`; a workbook customer, dimension or tag that differs from D365; a credit note; a record issue; a repeated payment serial (template format).

Open balance unavailable: a warning, and the balance is not validated.

## Job state and retries

| Status | Meaning |
|---|---|
| `REVIEWING` | Background review running |
| `REVIEW_FAILED` | Review could not complete (message kept); upload again |
| `PREVIEWED` | Reviewed. Submit allowed only when the summary says `canSubmit` |
| `SUBMITTING` | A submit owns the job |
| `BATCH_CREATED` | Batch exists, queueing not confirmed; submit re-queues the same batch |
| `QUEUED` | Durable posting job created |
| `SUBMIT_FAILED` | Batch exists, queueing failed; submit re-queues the same batch |
| `REVIEW_INTERRUPTED` (derived) | `REVIEWING` for more than 30 minutes (process restart) |
| `RECONCILE_REQUIRED` (derived) | `SUBMITTING` for more than 30 minutes with no batch |

Guarantees implemented and tested: one submit claims a job atomically; a job creates at most one batch; a repeated submit on a queued job creates nothing; a changed workbook or changed D365 value (including the offset-account status) changes the payload hash and requires a new review; a batch with line errors is never created; a queueing failure is retried against the same batch.

Not guaranteed: the review and submit run in process memory. A process restart leaves the job in `REVIEWING` or `SUBMITTING`; they are reported as interrupted and need a new upload (or administrator reconciliation for `SUBMITTING` with a batch). For production, the background work should move to the existing queue.

## Settlement

Posting is **unmarked**. The direct Cash-In path sets `SettlementIntent: 'Unmarked'` with `MarkedLines: []`, and nothing in the repository sets `customerSettlement`, so `settleCustomerPaymentLines` never runs for these lines. A posted batch creates an on-account customer receipt. **The invoice is not settled.** The job view reports `settlement: NOT_SETTLED_UNMARKED`.

## Open items

1. **SAFE values are not verified as D365 accounts.** Confirm each value against `BankAccounts` or `CashAccounts` in the company. Unknown values block their payments.
2. **Credit notes**: 70 invoices (and 2 rows rejected for blank SAFE). The file is blocked until they are removed. A verified credit-note posting path is needed before they can be posted.
3. **Payment remarks > 35 characters**: 8 rows (including the 3 USD rows). They cannot be posted as the D365 payment reference without truncation. Decide whether the reference can be left blank, stored elsewhere, or shortened by the source.
4. **Blank SAFE values**: 3 rows (2 on credit notes). The source must supply them.
5. **Payment ID**: the Yards format has no serial, so `PAYMENTID` is blank. Confirm whether D365 requires one, and what it should be.
6. **Workbook vs D365 differences**: not known until a live review. Each difference blocks its invoice.
7. **Rounding policy**: 17,139 amounts change at two decimals (net −1.34). The business must approve nearest rounding.
8. **Customer names**: 13 accounts carry more than one name in sheet `10-YARD-IST`. Names are not used for posting; the source should be reviewed.
9. **Scale**: a file of this size takes a long background review (about 2,000 batched reads plus per-account reads). Measured run time is not yet available.
10. **Settlement**: confirm whether Yard receipts must also settle invoices. The current flow does not.
11. **Per-invoice D365 confirmation**: outcomes mirror the batch status until D365 lines are read back.

## Non-production validation plan

Use only a verified non-production company, a dedicated posted test invoice, a test customer and test accounts. Do not use the supplied workbook's real rows against live D365 until items 1 to 6 are checked.

1. Check the lookup chain on the test invoice against the D365 UI: customer, currency, dimensions, tag, open balance and closed state.
2. Check each SAFE value used by the test rows as a `BankAccounts` or `CashAccounts` record: active, currency, date window.
3. Run the review on a copy of the workbook that contains only test rows. Confirm the sheet mapping, rounding change, credit-note and remark rejections, and workbook-versus-D365 differences.
4. Enable the flag in the non-production environment only. Submit one test job. Check the batch lines: account, offset, amount, currency, dimensions, tag, voucher type, date.
5. Check the posted voucher: an on-account receipt, invoice not settled (expected). Record the actual result.
6. Retry test: force a queueing failure, then retry; confirm one posting.
7. Rollback: disable the flag and reverse the test receipt through the approved D365 process. The approval owner must confirm the rollback path before step 4.

## Tests

Backend, `src/modules/cash/yard-invoice/*.spec.ts`, with synthetic workbooks built from the real layout definitions and a mocked D365 client. The enrichment tests use a filter-aware fake that checks the `or` grouping and the Int64 quoting. Client: `src/lib/yard-invoice-state.test.ts` and `…/yard-invoice-review.test.tsx`.
