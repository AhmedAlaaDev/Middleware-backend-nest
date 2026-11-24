# MAS Revenue Cash In: configuration and operation

This flow records **direct cash revenue** for company `mas`. For each receipt it debits the cash account for the full Total, credits the revenue account selected by the row's Revenue type for the Value, and credits the VAT account from the verified tax configuration for the VAT. VAT is credited exactly once.

Credit-customer invoicing and later customer collection are **not supported** by this flow. Those rows are rejected with an explanation, never processed as cash.

## Where the verified configuration comes from

Set `MAS_REVENUE_CONFIG_PATH` to a JSON file. If the variable is unset, or the file does not exist, every gate is closed and nothing can be submitted or posted. A file that exists but is malformed is an error.

The file is read when it is needed, so a corrected file takes effect without a restart.

Start from `MAS_REVENUE_CONFIG.example.json` in this folder. Its values are placeholders. Do not commit a file that contains real account IDs.

## Fields

| Field | Meaning | Gate when unset |
| --- | --- | --- |
| `journalName` | D365 GL JournalName for `LedgerJournalHeaders`. | Blocks |
| `cashAccountIdsByDisplayName` | Cash account ID for each name in the source Debit column. Only these names are treated as cash. | Blocks any other name |
| `cashDefaultDimension` / `cashFinancialTag` | Cash-side dimension (must be non-empty) and tag (an explicit empty string is allowed). | Blocks |
| `revenueAccountsByRevenueType` | Revenue account per source Revenue type text. Each entry has `account`, `defaultDimension` (non-empty), `financialTag` (both required in the file), and `verified`. | Blocks each unmapped or unverified type |
| `vatAccount` | Output VAT ledger account from the verified tax configuration, with its dimension, tag and `verified`. | Blocks |
| `vatRatePercent` | The VAT rate. Each row's VAT must equal this share of its Value (for example 14 gives 224.00 on 1,600.00). | Blocks |
| `exchangeRatesByCurrency` | Accounting and reporting rates per currency, in the verified scale. | Blocks |
| `deployedCompatibility.lineServiceVerifiedForGl` | Set `true` only after the cash-in line service has been proven to post these lines to a GL journal in this environment. | Blocks |
| `deployedCompatibility.glReadbackVerified` | Set `true` only after the LedgerJournalLines field names used for readback are confirmed here. | Blocks |

The Empty Container Loading Revenue / Loading revenue type is 415101 per the business instruction. Its mapping must still be verified. The key must be the exact Revenue type text the source file uses for it, which the example leaves as a placeholder.

## What each receipt posts

For a row with Value 1,600.00, VAT 224.00 and Total 1,824.00, and a verified revenue account for its Revenue type:

1. Cash account debited 1,600.00, offset to the revenue account for the Revenue type.
2. Cash account debited 224.00, offset to the VAT account.

The two debits add up to the Total. Each line is balanced against its own offset account, and the VAT line is the only place VAT is credited. Rows with zero VAT produce one line.

## What is checked when

1. **Preview**: parses and validates the workbook and stores a snapshot. Configuration blockers are listed in the response, but a clean upload is still reviewed. Nothing is created in D365 or in the batch store.
2. **Create batch** (`CashIn-MAS-Revenue-Reviews/:id/submit`): re-checks ownership, the review state, the payload hash, the configuration gates, and whether an invoice was already submitted for this company. Creates the Cash In batch only.
3. **Send to D365FO** (existing `PostToDFO`): re-checks the configuration and the stored receipt snapshot, creates one GL header per planned journal, posts the lines, and reads the journal back. A content mismatch stops the batch as non-retryable.

## Receipt identity (version 2)

A receipt is identified by four values, and only these:

| Part | Source |
|---|---|
| Company | `mas`, the only accepted company |
| Source namespace | `MAS_DIRECT_REVENUE`, a server constant. Never read from a file, column or request |
| Year | The year of the receipt's `Date` (TransactionDate). This is the transaction year, not an independently verified invoice fiscal year |
| Invoice number | The original invoice number, normalized with the same rule as validation (Unicode NFC, whitespace collapsed and trimmed). Kept unchanged for display and document fields |

Not part of the identity: upload time, the current year, the file name, the sheet, the row, or any user-editable label. No template column was added. The template is unchanged.

The canonical key is `JSON.stringify([2, company, namespace, year, invoice])`, so separators inside invoice text cannot make two identities equal. Its SHA-256 is the identity hash. The implementation is `src/modules/cash/mas-revenue/mas-revenue-identity.ts` (one function, used everywhere).

**PaymentIds.** The D365 `PaymentId` for a version 2 receipt is `MR<year>-<16 hex of the identity hash>`, with `-REV` or `-VAT` on the GL lines. That is 23 characters, or 27 with a suffix. The repository has no verified `MaxLength` for `LedgerJournalLines.PaymentId` (the metadata leaves it empty), so the limit used is 30 (`MAS_REVENUE_PAYMENT_ID_MAX_LENGTH`). A longer id refuses the post. It is never truncated. The hash keeps every invoice text, including long ones, within the limit without changing the identity.

**Legacy receipts (version 1).** A snapshot or batch with no `IdentityVersion` keeps its old identifiers, `MASREV-<invoice>` and `MASREV-<invoice>-REV|VAT`, so retries and readback of records already queued or posted still match.

**Where the identity is enforced**

1. Preview: the snapshot records `IdentityVersion: 2`. Duplicate invoice numbers within one file are still blocked, as before.
2. Submit, in order:
   - Snapshots without `IdentityVersion` are refused ("created before the receipt identity was introduced; upload the file again").
   - Existing receipts of the same invoice number are checked, from batch lines and from identity claims, in any year.
   - The claim reservation is one atomic write. Two submits of the same receipt cannot both succeed (see below).
3. Batch: each record stores `IntegrationIdentity` (the canonical key, version 2 only) and `IdentityVersion`.
4. Posting (`PostToDFO`) rebuilds the same PaymentIds from the stored snapshot, so retries produce the same ids.

**Outcome of a submit when a receipt matches an existing one**

| Existing receipt | Result |
|---|---|
| Same company, year and invoice | `DUPLICATE_RECEIPT`: blocked |
| Same invoice, another year, **same content** (value, VAT, customer, container, B/L, revenue type, cash account, currency; date and row excluded) | `CORRECTION_REQUIRED`: blocked. This is a re-dated submitted receipt. Silently creating a new transaction would double-count it. Explicit correction handling (reversal and replacement) is not implemented in this flow |
| Same invoice, another year, **different content** | Distinct receipt: allowed, with its own PaymentIds |
| Legacy record whose date is not a real calendar date | `RECONCILIATION_REQUIRED`: blocked until the record is reconciled |
| Two submits of the same receipt at the same moment | One succeeds. The other returns `DUPLICATE_RECEIPT` and creates no batch |

**Concurrency and atomicity.** The collection `mas_revenue_receipt_claims` has two unique indexes: `{company, identityKey}` and `{company, paymentIdBase}`. A submit inserts one claim per receipt. A refused insert removes this review's partial claims. If batch creation fails before a batch exists, the review's claims are released, so the same receipt can be submitted again with the same identity. Once the batch exists, the claims carry its `batchId`. A crash between reserving and creating the batch leaves unbatched claims for that review; see `MAS_REVENUE_IDENTITY_MIGRATION.md` for the reconciliation procedure.

**Duplicate-within-file rule.** Unchanged. Invoice numbers that differ only by case are different identities, as they were before. This is a business decision that is still open.

## Rejected scenarios and their explanations

- A Debit value that is not a configured cash account: "debit value ... is not a configured cash account ... customer-credit invoicing and later collection are not implemented".
- A row with an empty Revenue type: the revenue account is required.
- A Revenue type with no configured revenue account, or one that is unverified.
- A VAT that does not equal the configured rate of the Value.

Cash versus credit is never inferred from the customer name. A direct cash record may still carry customer information.

## Limits to know

- Only the petty-cash account type (`RCash`) is posted. Bank accounts need an account-type decision and a separate verification before they are used.
- The LedgerJournalLines field names used for readback follow the D365 entity but are not verified in this codebase. Keep `glReadbackVerified` false until they are checked against the target environment.
- Each line sets TaxGroup `Non-Taxabl`, so D365 does not calculate tax on top of the explicit VAT line.

## Journal-lines template (template version 2)

Version 2 is a general petty-cash journal template. One row is one D365 journal line, entered the way the finance team enters it (journals GL-GNL-0000000000269 to 273). It replaces the fixed two-line receipt design for new uploads; the source layout (version 1) is still read.

The upload is recognised by its sheet name, **Journal Lines**. Download it from `GET DataMigration/Cash/CashIn-MAS-Journal-Template` (guide: `CashIn-MAS-Journal-Guide`). The **Examples** sheet is never read.

Each row states its own: journal name, date, account type and account, offset account type and offset account, debit or credit amount, item sales-tax group and document number. Optional: text, currency check, posting profile, sales-tax group, default dimensions and financial tags of each side.

**Cash In only.** The upload is for money received into petty cash. A receipt can be written either way round: cash as the Account with the amount in DEBITAMOUNT, or cash as the Offset account with the amount in CREDITAMOUNT of the ledger line. A row that would take cash out of petty cash (a credit on the petty-cash account, or a debit on the ledger account with petty cash as the offset) is rejected in the review and the column is named. Payments are not part of this upload.

**Nothing about the entry comes from company configuration.** D365 is asked, read-only, at review and again at posting:

- the cash ID exists as a petty-cash (RCash) account; its currency is the line currency (a CURRENCYCODE in the file must agree);
- each ledger main account and each item sales-tax group exists;
- the reporting exchange rate for the transaction date (100 divided by the USD to EGP rate valid on that date); the accounting rate is the verified factor for the currency.

What stays gated is only the environment evidence: `deployedCompatibility.lineServiceVerifiedForGl` and `glReadbackVerified`, which a sandbox test posting settles. Blockers come back as `{message, errors}` so the standard validation modal lists each reason.

Identity: the document number is the line identity (unique in the file; every repeat is blocked). The PaymentId is built the same way as version 1 (`MR<year>-<hash>-REV`). Journals are numbered per month and per journal name, at most 1000 lines each, and one journal holds one journal name.
