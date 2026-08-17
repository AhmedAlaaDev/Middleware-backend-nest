# Cash Module Documentation

The full lifecycle and refactor plan are documented in
`.docs/CASH_MODULE_REFACTOR_AND_LIFECYCLE.md`.

## Processor layout

```text
cash/processors/
├── base/base-cash-entry.processor.ts
├── inbound/
│   ├── cash-in-entry.processor.ts
│   ├── freight/cash-in-freight-entry.processor.ts
│   └── fleet/cash-in-trucking-entry.processor.ts
└── outbound/
    ├── cash-out-entry.processor.ts
    ├── freight/cash-out-freight-entry.processor.ts
    └── fleet/cash-out-trucking-entry.processor.ts
```

## D365FO payload path

Enhanced records are built by the base processor and stored in a `DataBatch`.
Posting is asynchronous:

```text
DataBatch
  -> PostCashBatchToDFOHandler
  -> post-customer-payment-journal-dfo queue job
  -> CashJournalPostingStrategy
  -> CustomerPaymentJournalService
  -> d365foClient.post(endpoint, requestBody)
```

Cash-In uses:

```text
/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransCustPaym
```

Cash-Out uses:

```text
/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransVendPaym
```

Cash-Out bulk bodies are created in
`CustomerPaymentJournalService.postCustomCashLines` as:

```ts
{
  _contract: {
    Lines: lines.map((line) => this.toD365BulkCashLine(line)),
  },
}
```

Any future builder extraction must preserve the enhanced records and the
serialized request body exactly. See the refactor outline for the required
characterization-test approach.

## Current high-risk extraction boundary

`cash-line-building.service.ts` now owns grouped-line dispatch only. It
selects Cash-In two-line/multi-line builders and Cash-Out vendor/source builders
through callbacks. The actual business implementations remain in the base
processor until their output characterization tests are complete.

## Compatibility boundary

`BaseCashEntryProcessor.buildLines` is retained temporarily because legacy
unit tests and subclasses call the protected method directly. The production
path uses `buildInvoiceLines`, which delegates invoice iteration to
`buildCashInvoiceLines` and grouped routing to `buildCashLines`.

The wrapper may be removed only after all in-repository callers are migrated
to the extracted service or to `buildInvoiceLines`, and the full Cash test
suite confirms identical enhanced records for Cash-In, Cash-Out, Freight,
Fleet, vendor payments, withholding, settlement, and exchange-rate cases.
