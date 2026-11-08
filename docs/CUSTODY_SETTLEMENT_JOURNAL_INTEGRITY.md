# Custody Settlement journal integrity

How Custody Settlement uploads reach D365 as balanced, correctly identified
journal lines, and what to do when a safeguard stops a posting. Applies to the
Custody Settlement route only; Vendor Payment is deliberately unchanged.

## 1. Why requests must balance

The X++ service `TSLedgerJournalIntegration.addLedgerJournalTransVendPaym`
assigns vouchers **per request**. Lines without an offset account share one
voucher until debit equals credit (one-cent tolerance), then a new voucher
starts; a new request always starts a fresh voucher. A request that does not
balance on its own therefore lands in an unbalanced voucher, even when the
source file balances overall.

Custody Settlement used to split one UniqueId into one request per invoice.
Those one-sided invoice groups produced unbalanced vouchers (on the reference
workbook: 157 of 328 requests, 68 of 226 UniqueIds).

Rules now (`cash-out-request-grouping.ts`):

- A UniqueId is one request, with its lines in **source order**.
- An invoice group may be sent as its own request **only if it balances by
  itself** (exact cents). Everything else stays in the UniqueId's main request.
- Before a request is sent, a guard refuses one that would leave an open
  voucher: `[JOURNAL_IMBALANCE]`. Requests mixing currencies are not compared
  (they balance in the accounting currency, validated earlier).

There is no verified D365 limit on request size; a UniqueId is never split to
fit one. UniqueId 534844 of the reference workbook is a single 732-line
request.

## 2. Line identity (retry and timeout recovery)

D365 numbers journal lines in insertion order and requests are not sent in
planned order, so a **planned line number is never an identity**. A line is
identified by content, using fields verified on `VendorPaymentJournalLines`:

`PaymentId` (source UniqueId) + `AccountType` + account + `CurrencyCode` +
`DebitAmount` + `CreditAmount`

Ledger accounts are identified by their main account. Their dimension string
is verified separately and case-insensitively: D365 keeps only the dimensions
its account structure allows for a main account and stores the rest empty
(verified on Mesco-000019501: `124101` keeps all 13, `223404` and `223712` keep
4), so a dimension value that D365 **dropped** is accepted (and logged), while a
value that D365 **changed or added** is a mismatch. Amounts are integer cents,
rounded half-up like D365 (source files can carry 4 decimals, D365 stores 2).

Identical lines (repeated amounts) are matched as a multiset:

| Situation | Result |
|---|---|
| D365 holds none / exactly the planned count | not posted / already present |
| fewer or more identical lines than planned | `[JOURNAL_RECOVERY_AMBIGUOUS]`: the UniqueId is skipped and never re-posted |
| UniqueId partly present | skipped ("only partially present"), never resumed |
| client timeout, all submitted lines are new | committed: not re-sent |
| client timeout, none are new | the timeout is raised |
| client timeout, only some are new | `[JOURNAL_RECOVERY_AMBIGUOUS]`, stop |
| journal cannot be read | `[JOURNAL_READBACK_FAILED]`, stop before posting |

Recovery works from D365 alone, so it survives an application restart.

## 3. Post-write verification gate

Before any invoice settlement mark is written, the **complete** actual journal
is read (all pages, following `@odata.nextLink`, refusing a repeated page or
repeated line) and compared line by line with the expected journal (the
batch's planned lines for that header, minus skipped UniqueIds):

| Code | Meaning |
|---|---|
| `JOURNAL_LINES_MISSING` | fewer identical lines in D365 than planned |
| `JOURNAL_LINE_MISMATCH` | extra, duplicated or wrong line (account, currency, amount), or a ledger dimension value that D365 changed or added (values D365 drops are accepted) |
| `JOURNAL_IMBALANCE` | a D365 voucher does not balance (offset-less journals) |
| `JOURNAL_READBACK_FAILED` | the journal could not be read back |
| `JOURNAL_RECOVERY_AMBIGUOUS` | existing lines cannot be attributed (section 2) |

On any failure **no settlement mark is written** and the journal is left as it
is. Do not delete lines blindly: read the message (it names the UniqueId, the
account and amounts), compare with D365, and correct the journal manually; a
retry then reuses the same header and posts only what is genuinely missing.

## 4. Tests and tools

- `custody-settlement.large-uniqueid.spec.ts`: request grouping and the guard.
- `custody-settlement.recovery.spec.ts`: identity, restart and timeout recovery.
- `cash-journal-readback.spec.ts`, `cash-journal-line-identity.spec.ts`,
  `vendor-payment-journal.service.line-details.spec.ts`: verifier, identity and
  pagination.
- `vendor-payment.golden-master.spec.ts`: Vendor Payment output compared with
  a snapshot generated from the code **before** this work (`2e01e35`).
- Opt-in full-workbook replay (not run by default; workbooks hold financial
  data and are not committed):

  ```bash
  CUST_FILE=/path/to/workbook.xlsx pnpm jest custody-settlement.workbook-replay
  ```

  It parses, formats, maps and groups the workbook with the production code,
  simulates D365 committing each request (own line numbers, X++ voucher rule),
  verifies the resulting journal, proves tampering is detected, and simulates a
  restart. D365 lookups (vendor groups, invoice snapshots, dimensions,
  exchange rates) are stubbed.

## 5. Native withholding

Unchanged: native withholding stays disabled by default
(`CASH_OUT_NATIVE_WITHHOLDING_*` gates) and the explicit `223304` entry is the
behaviour. See `CASH_OUT_ENHANCEMENTS_BUSINESS_LIFECYCLE.md`.
