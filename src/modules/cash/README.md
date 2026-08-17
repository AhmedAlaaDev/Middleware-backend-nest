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
