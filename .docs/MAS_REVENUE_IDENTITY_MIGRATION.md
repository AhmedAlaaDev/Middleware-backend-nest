# MAS Revenue receipt identity: legacy inventory, migration and backfill plan

Status: the code change is implemented and tested in isolation. **No migration or backfill has been run.** Nothing here has touched a connected or shared database. The isolated `mas_check` database was inspected read-only, as described in section 1. Every write step below needs explicit authorization for the named environment.

Read with [MAS_REVENUE_CASH_IN.md](MAS_REVENUE_CASH_IN.md), section "Receipt identity (version 2)".

## 1. Inventory performed

Isolated `mas_check` database (Docker `mas-check-mongo`, port 27027), read-only:

| Item | Finding |
|---|---|
| `mas_revenue_reviews` | 1 document, status PREVIEWED, no batch |
| `mas_revenue_review_lines` | 1 line, invoice `1`, date `2026-10-28`, no batch |
| `mas_revenue_receipt_claims` | Absent before this change (new collection) |
| `data_batches` with company `mas` | 3, all Yard test batches (entry processor type 32). **No MAS Revenue batch** |
| Enhanced records of those batches | Yard records only. No `MASREV-` PaymentId exists in this database |
| Indexes on review collections | As before: `{company, createdByUserId, created_at}`, `{reviewId, position}`, `{company, invoiceNumber, batchId}`. None unique |

Not inspected: any connected database (development, staging, production, or the Contabo live database). Doing that needs authorization, and it is the first step of section 4.

## 2. What the change stores and enforces

| Change | Storage effect | Risk to existing data |
|---|---|---|
| New collection `mas_revenue_receipt_claims` with unique `{company, identityKey}` and unique `{company, paymentIdBase}` | New, empty collection. Index build runs when the app starts (Mongoose autoIndex) | None to existing collections. On an empty new collection the unique build cannot fail |
| Snapshots gain `IdentityVersion: 2` | New snapshots only | None. Legacy snapshots have no field and are read as version 1 |
| Batch records gain `IntegrationIdentity` and `IdentityVersion` | New batches only | None |
| PaymentId for version 2 batches | New batches only | None to posted batches |
| Submit refuses snapshots without `IdentityVersion` | Affects only reviews created before this change that are not yet submitted | Such reviews must be uploaded again |
| Posting validator refuses PaymentIds over 30 characters, or missing ones | Affects posting only | None to posted data |

No existing document, index or field is changed or removed by the code.

## 3. Legacy classification

Each existing submitted record is classified by what can be proven from stored data. Nothing is assumed safe.

| Class | Test on stored data | Treatment |
|---|---|---|
| **L1. Submitted, reliable date** | Line has `batchId`, no `IdentityVersion` in `raw`, `transactionDate` is a real `YYYY-MM-DD` date | Protected at runtime immediately: the submit checks compare the year. Backfill (section 4) adds a claim so the unique index also covers it. The batch keeps its legacy PaymentIds |
| **L2. Submitted, unreliable date** | `batchId` set, date not a real calendar date (for example `2026-02-30`) | Protected at runtime: any new receipt for the same invoice is blocked with `RECONCILIATION_REQUIRED`. Reconcile by hand (section 5) before anything else. No claim is backfilled |
| **L3. Legacy duplicate** | Two or more L1 lines with the same company, invoice and year, in different batches | Already a duplicate in legacy data. Backfill stops for that identity and lists it. A person decides which batch stands. Nothing is reversed automatically |
| **L4. Previewed, not submitted** | Review status PREVIEWED or SUBMIT_FAILED, snapshot with no `IdentityVersion` | Refused at submit. The user uploads the file again, which creates a version 2 snapshot |
| **L5. Queued or posted legacy batch** | Batch created before the change, its records carry `MASREV-` PaymentIds | Unchanged. Posting and retries rebuild the legacy PaymentIds from the legacy snapshot, so readback and resume keep matching what D365 holds |

Count the classes before any backfill (queries in section 4, step 1). Do not run the backfill while L2 or L3 is non-empty without a decision on each record.

## 4. Backfill plan (not run)

Requires authorization for the named environment. Run in the order given. Steps 1 and 2 are read-only.

1. **Dry-run classification (read-only).** Count L1, L2 and L3 for the target company `mas`:
   - Lines: `mas_revenue_review_lines` with `company: "mas"`, `batchId` set. Group by `invoiceNumber` and by year of `transactionDate` (only when it matches `^\d{4}-\d{2}-\d{2}$` and is a real date).
   - Any group with more than one batch is L3. Any line with an unreliable date is L2.
2. **Stop and decide.** If L2 or L3 is non-empty, record a decision per record (section 5) before step 3.
3. **Backfill claims for L1 (write, authorized).** For each L1 line, insert one claim into `mas_revenue_receipt_claims`:
   - `company` `mas`, `identityKey` = canonical key from `masRevenueIdentity({transactionDate, invoiceNumber}).key`, `paymentIdBase` from the same function, `invoiceNumber`, `year`, `fingerprint` from `masRevenueFingerprint(storedRawToReceipt(raw))`, `reviewId` from the line, `batchId` from the line.
   - Use the same code (`masRevenueIdentity`, `masRevenueFingerprint`), never a second implementation.
   - Insert in one batch. If any unique index refuses an insert, stop and list that identity as L3. Do not overwrite.
   - Never change the batch records, their PaymentIds or the review lines.
4. **Verify.** Every L1 line has exactly one claim with the same `batchId`. The claim count equals the L1 count. Run the verification query in section 6.

Rollback of step 3: delete the claims inserted by the backfill (`{batchId: {$in: [<backfilled batch ids>]}}`). The collection holds nothing else until the first new submit. Deleting claims removes only protection, never data. Re-run the backfill after the cause is fixed.

## 5. Reconciliation of L2, L3 and stuck claims

- **L2 (unreliable legacy date).** Find the source workbook for the batch. If its date is verified, correct the stored date in a documented change with the reviewer's name, then reclassify as L1. If it cannot be verified, the record stays blocked. The invoice cannot be submitted again without a decision.
- **L3 (legacy duplicate).** Decide which batch stands. The other batch needs a reversal or a documented note in the finance ledger. This is not done by code.
- **Stuck claims (crash between reservation and batch creation).** A claim with `batchId: null` and a review in status SUBMITTING, or in SUBMIT_FAILED after a crash, blocks its receipts. Procedure:
  1. For each such `reviewId`, look for a batch whose records carry that receipt's `MasRevenueRaw` and `IdentityVersion: 2`.
  2. If the batch exists, set the claim's `batchId` to it and set the review to BATCH_CREATED with that `batchId`.
  3. If no batch exists, delete the claims (`{reviewId, batchId: null}`) and set the review to SUBMIT_FAILED with a note. The receipt can then be submitted again with the same identity.

## 6. Verification queries (read-only)

```javascript
// Claims without a batch (candidates for reconciliation, section 5)
db.mas_revenue_receipt_claims.find({ batchId: null }, { reviewId: 1, identityKey: 1, invoiceNumber: 1 })

// Identity uniqueness: must return no rows
db.mas_revenue_receipt_claims.aggregate([
  { $group: { _id: { company: "$company", identityKey: "$identityKey" }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }
])

// Legacy lines that have no claim after the backfill (must be only L2 and L4)
db.mas_revenue_review_lines.find({ company: "mas", batchId: { $nin: [null, ""] }, "raw.IdentityVersion": { $exists: false } }, { invoiceNumber: 1, transactionDate: 1, batchId: 1 })
```

## 7. Rollback of the code

- Reverting the code stops the identity checks. Claims in the new collection are then ignored, and submits fall back to the old invoice-only check.
- Batches created with version 2 PaymentIds: the reverted posting path rebuilds legacy PaymentIds from their snapshot. This changes the PaymentId of a batch that has not yet been posted. **Post or cancel every version 2 batch before reverting**, and check their status first (`IdentityVersion: 2` on `data_enhanced_records`).
- Do not drop the claims collection while version 2 batches are awaiting posting. Its unique indexes are the only protection against a second batch for the same receipt.

## 8. Open items

1. The sandbox must confirm the `LedgerJournalLines.PaymentId` field limit. The limit in use is a conservative 30. If D365 allows more, the limit can be raised in one place (`MAS_REVENUE_PAYMENT_ID_MAX_LENGTH`), but only for new identifiers.
2. Readback does not compare PaymentIds. The read fields (`LedgerJournalLines`) do not include `PaymentId`. Retry matching for MAS posting goes through the existing line loader. Add `PaymentId` to the readback only after the field is verified in the sandbox.
3. A genuine re-dated receipt, with the same content and a different year, is refused as `CORRECTION_REQUIRED`. Explicit correction (reversal of the earlier journal and replacement) is not designed.
4. Invoice numbers that differ only by case are distinct identities. Whether to fold case is a business decision.
5. The claims collection is written by the review service only. If a future flow posts MAS Revenue without a claim, the unique indexes do not protect it. The posting path should check for a claim before it posts.
