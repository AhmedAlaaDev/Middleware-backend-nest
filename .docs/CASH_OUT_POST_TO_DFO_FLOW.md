# Cash-Out: Post Cash Batch To D365FO (Custom Line APIs)

This document describes what happens when a user triggers the **Cash-Out** posting endpoint:
`POST /DataMigration/Cash/PostToDFO` (controller: `src/modules/cash/cash.controller.ts`).

The flow keeps the **existing journal header posting** unchanged, while routing **cash-out journal lines** through the custom X++ endpoints:

- Cash-out line API: `/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransVendPaym`
- Cash-in line API: `/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransCustPaym` (not used in this doc, but shares the same pipeline)

---

## Entry Point

### Request
`POST /DataMigration/Cash/PostToDFO`

Body:
```json
{ "batchId": "..." }
```

Controller handler:
- `CashController.postToDFO()` -> `commandBus.execute(new PostCashBatchToDFOCommand(batchId))`

---

## High-Level Flow (Cash-Out)

### 1) Command handler validates + prepares queue payload
Handler: `src/modules/cash/handlers/post-cash-batch-to-dfo.handler.ts` (`PostCashBatchToDFOHandler`)

Key steps:
1. `validateBatch(batchId)`
   - Loads the data batch from Mongo.
2. Detect cash direction from batch processor type
   - `getCashDirection(batch.entryProcessorType)`:
     - `CashOutFreight` -> `cashDirection = "out"`
     - `CashOutTrucking` -> `cashDirection = "out"`
3. Ensure the batch type is supported for posting
   - Allowed: CashIn/CashOut (Freight + Trucking)
4. Group enriched records by `JournalBatchNumber`
   - `groupRecordsByJournalBatchNumber()`
5. Build queue payload
   - Header request is still the normal OData contract
   - Line request is **only** the prebuilt custom body:
     - each queued line contains: `customLineApiBody`
     - the strict custom keys are built here in the cash module handler
   - `journalNum` is initially set to `""` here and will be overwritten later after header posting succeeds.
6. Validate payload
   - `validateCustomerPaymentJournals()` checks:
     - header required fields
     - line required fields are validated via `customLineApiBody` only
7. Prepare batch for posting
   - status -> `Processing`
   - clear previously collected DFO posting errors
8. Enqueue BullMQ job
   - Queue: `QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL`
   - Processor name: `post-customer-payment-journal-dfo`
   - Job payload includes: `groupedJournals` + `cashDirection`

---

### 2) BullMQ processor posts headers, then posts cash-out lines
Processor: `src/modules/queue/processors/post-customer-payment-journal-dfo.processor.ts`

Posting order per journal group:
1. `strategy.postHeadersInBatches([header], 1)`
   - Header uses the existing OData header endpoint.
2. Capture created header key
   - `headerKey` is the created `JournalBatchNumber` from the header response.
3. `strategy.postLinesForHeader(headerKey, journal.lines, ...)`
   - Since this is cash-out, the strategy routes to:
     `CustomerPaymentJournalService.postCashOutLinesForHeader(...)`

---

### 3) Line posting uses the custom cash-out endpoint
Service: `src/modules/d365fo/services/customer-payment-journal.service.ts`

For each cash-out line:
1. The service reads the prebuilt `line.customLineApiBody`
2. It **overwrites** `journalNum` with the successful `headerKey`
   - This satisfies: `journalNum = journalBatchNumber from header posting after success`
3. It POSTs to:
   `.../addLedgerJournalTransVendPaym`
4. Success criterion:
   - `StatusCode === "Success"`
5. Failure surfaces:
   - throws an Error with the returned `Message`

Idempotency / duplicate skipping:
- Before posting lines, it queries existing line numbers via:
  `listLinesForHeader()` which lists `/data/CustomerPaymentJournalLines(LineNumber)`
- If a line number already exists, the service skips posting that line.

Note: This skip logic is still based on the legacy entity lookup, even though the actual insert is via custom endpoints.

---

## All Cash-Out Scenarios

### Scenario A: Happy path (CashOutFreight or CashOutTrucking)
Conditions:
- batch exists
- entryProcessorType is `CashOutFreight` or `CashOutTrucking`
- enhanced records exist and group successfully
- each line has a valid `customLineApiBody`

Result:
1. Headers posted normally to OData header API
2. For each line:
   - custom body sent to `addLedgerJournalTransVendPaym`
   - `journalNum` overwritten with the created header batch number
3. Batch marked `Completed`

---

### Scenario B: Batch not found
Where:
- `PostCashBatchToDFOHandler.validateBatch(batchId)`

Result:
- `NotFoundException`
- Job is not enqueued

---

### Scenario C: Unsupported `entryProcessorType`
Where:
- `PostCashBatchToDFOHandler.ensureCashEntryProcessor()`

Result:
- `BadRequestException`
- Job is not enqueued

---

### Scenario D: No enhanced records for the batch
Where:
- `groupRecordsByJournalBatchNumber()`

Result:
- `NotFoundException('No enhanced records found for this batch')`
- Job is not enqueued

---

### Scenario E: Payload validation fails (custom line body)
Where:
- `validateCustomerPaymentJournals()` -> `validateLine()`

Validation checks:
- `line.cashDirection` must exist
- `line.customLineApiBody` must exist and must include required strict keys

Typical causes:
- missing `customLineApiBody.AccountNum`
- missing `customLineApiBody.accountTypeStr`
- missing `customLineApiBody.company`
- missing `customLineApiBody.currency`
- missing `customLineApiBody.DEFAULTDIMENSIONDISPLAYVALUE`
- missing `customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE`
- missing `customLineApiBody.offsetAccountDisplayValue`
- missing `customLineApiBody.OffsetAccountTypeStr`
- missing `customLineApiBody.OffsetCompany`
- missing `customLineApiBody.transDate`
- missing `customLineApiBody.PostingProfile`

Result:
- HTTP `BadRequestException` with per-line missing field details
- No job is enqueued

---

### Scenario F: Header posting fails
Where:
- processor calls `strategy.postHeadersInBatches()`
- if OData header creation throws, the error bubbles out of posting loop

Result:
- batch marked `Canceled`
- rollback runs for created headers (if any were created before the failure)
- posting errors are stored via `handlePostingFailure()`

---

### Scenario G: Header succeeded, but one cash-out line fails
Where:
- processor successfully gets `headerKey`
- then calls `strategy.postLinesForHeader()`
- service POST fails to `addLedgerJournalTransVendPaym`
- service throws if `StatusCode !== "Success"`

Result:
1. Processor catches error and runs `handlePostingFailure()`
   - writes formatted errors
   - batch status -> `Canceled`
2. If any headers were created, rollback attempts:
   - `rollbackAll()` deletes headers and lines using the strategy’s deletion methods
   - deletion uses the legacy D365FO OData routes under `CustomerPaymentJournalHeaders/Lines`

---

### Scenario H: Testing mode (development environment)
Where:
- `applyTestingMode()` in `PostCashBatchToDFOHandler`

Behavior:
- Only enqueues:
  - the first journal header
  - up to `testingModeMaxLines` (currently `10`)

Result:
- lets you safely validate cash-out custom line posting end-to-end with limited data

---

### Scenario I: Duplicate lines already exist
Where:
- `CustomerPaymentJournalService.postCashLinesForHeader()` checks `existingLines`

Behavior:
- It queries existing line numbers for the header using the legacy OData line listing.
- Any line with `LineNumber` already present is skipped.

Result:
- posting continues for remaining lines

---

## Custom API Body Notes (Cash-Out)

The strict request payload is built in:
- `src/modules/cash/handlers/post-cash-batch-to-dfo.handler.ts`

It is sent as-is (with only `journalNum` overwritten during posting).

Unknown/uncertain mappings are kept empty with `TODO` comments in the handler:
- `PAYMENTSPECIFICATION` is set to `''` with a TODO
- `PAYMENTMETHODNAME` uses a fallback based on `OffsetAccountTypeStr`, with a TODO to confirm the correct source

---

## Where to Look in Code

- Controller + endpoint: `src/modules/cash/cash.controller.ts`
- Cash-out direction + queue payload mapping: `src/modules/cash/handlers/post-cash-batch-to-dfo.handler.ts`
- Job execution order + rollback: `src/modules/queue/processors/post-customer-payment-journal-dfo.processor.ts`
- Cash-out custom endpoint posting + `StatusCode` success check:
  `src/modules/d365fo/services/customer-payment-journal.service.ts`

