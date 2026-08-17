# Base Cash Entry Processor Function Outline

This file is the working inventory for refactoring `src/modules/cash/processors/base-cash-entry.processor.ts`.

## Refactoring rule

Every method must retain its current input/output behavior, error keys, error messages, ordering, side effects, and D365FO field names. A method is moved only after a characterization test covers it. The base processor remains as a compatibility façade during the migration.

## Function inventory

| Function                                  | Current role                                                                                  | Planned destination                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `constructor`                             | Receives shared processor dependencies and initializes cash-specific services.                | `CashProcessorDependencies` plus injected collaborators; keep façade constructor initially. |
| `formatAndEnrichAsync`                    | Orchestrates the complete raw-to-enhanced cash pipeline.                                      | `CashEntryPipelineService`; base method delegates.                                          |
| `validateAsync`                           | Applies cash dimensions, invoice, route, and marked-invoice validation.                       | `CashValidationService`; base method delegates.                                             |
| `insertIntoDynamicsAsync`                 | Compatibility no-op because posting is queue-based.                                           | Keep as documented compatibility method until base contract changes.                        |
| `mapToModel`                              | Converts generic raw rows to cash raw models with Freight/Fleet and inbound/outbound context. | `CashNormalizationService`.                                                                 |
| `validateCashOutSourceAsync`              | Validates cash-out source dimensions, settlement targets, and source-level rules.             | `CashOutSourceValidationService`.                                                           |
| `collectSourceDimensionErrors`            | Collects source dimension errors for one cash-out line.                                       | `CashOutSourceValidationService`.                                                           |
| `collectSettlementTargetErrors`           | Validates custody/settlement target data against D365FO.                                      | `CashSettlementValidationService`.                                                          |
| `assignMissingUniqueIds`                  | Ensures source rows can be grouped into vouchers/invoices.                                    | `CashNormalizationService`.                                                                 |
| `getJournalName`                          | Resolves journal name from cash direction/product line and Safe Type.                         | `CashJournalPolicy`.                                                                        |
| `resolveCashOutJournalRoute`              | Resolves Cash-Out AP/GL/AR journal route.                                                     | Existing `CashJournalRoutingService`; remove duplicate orchestration later.                 |
| `getCollectionDescriptionLabel`           | Produces inbound collection description text.                                                 | `CashDescriptionPolicy`.                                                                    |
| `filterLines`                             | Separates custody settlements, vendor payments, and ordinary lines.                           | `CashLineClassificationService`.                                                            |
| `processCustodySettlementLines`           | Converts custody settlement rows into closing commands/records.                               | `CashSettlementService`.                                                                    |
| `processVendorPaymentLines`               | Converts vendor payment rows into vendor commands/records.                                    | `CashVendorPaymentService`.                                                                 |
| `checkInvoiceBalancedAfterFx`             | Checks grouped invoices after exchange-rate conversion.                                       | `CashInvoiceBalanceService`.                                                                |
| `buildInvoiceLines`                       | Builds all D365FO lines per grouped invoice.                                                  | `CashDfoLineBuilder`.                                                                       |
| `buildLines`                              | Chooses two-line or multi-line invoice construction.                                          | `CashDfoLineBuilder`.                                                                       |
| `buildVendorPaymentLines`                 | Builds outbound vendor-payment lines.                                                         | `CashVendorPaymentLineBuilder`.                                                             |
| `findWithholdingLine`                     | Locates the withholding line associated with an invoice.                                      | `CashWithholdingService`.                                                                   |
| `caseTwoLines`                            | Handles the two-line invoice transformation rule.                                             | `CashInboundLineBuilder` / `CashOutboundLineBuilder`.                                       |
| `caseMoreThanTwoLines`                    | Handles multi-line invoice transformation rules.                                              | `CashInboundLineBuilder` / `CashOutboundLineBuilder`.                                       |
| `buildLine`                               | Common line construction and direction dispatch.                                              | `CashDfoLineBuilder`.                                                                       |
| `buildLineInbound`                        | Builds inbound customer-payment/collection line fields.                                       | `CashInboundLineBuilder`.                                                                   |
| `buildLineOutbound`                       | Builds outbound cash journal line fields.                                                     | `CashOutboundLineBuilder`.                                                                  |
| `buildSourceLineOutbound`                 | Builds outbound source-derived line fields.                                                   | `CashOutboundLineBuilder`.                                                                  |
| `resolveCashOutExchangeRate`              | Resolves the outbound transaction exchange rate.                                              | Existing `CashOutExchangeRateService` plus mapping adapter.                                 |
| `addCashOutExchangeRateErrors`            | Adds exchange-rate validation errors to an outbound line.                                     | `CashOutExchangeRateService` mapping adapter.                                               |
| `filter22420LedgerDimensions`             | Applies the special 22420 ledger-dimension rule.                                              | `CashAccountDimensionPolicy`.                                                               |
| `is22420LedgerDimensionLine`              | Identifies a 22420 ledger line.                                                               | `CashAccountDimensionPolicy`.                                                               |
| `replaceFinTagShippingLineWithVendorName` | Replaces the shipping-line FinTag segment for outbound vendor lines.                          | `CashFinTagService`.                                                                        |
| `toCashDefaultDimensionDisplayValue`      | Serializes cash dimensions in the D365FO cash API order.                                      | `CashDimensionSerializer`.                                                                  |
| `resolveOffsetAccountDisplayValue`        | Resolves the offset account dimension value.                                                  | `CashDimensionSerializer` / `CashAccountResolver`.                                          |
| `dimensionPartAsString`                   | Normalizes one dimension segment.                                                             | `CashDimensionSerializer`.                                                                  |
| `isNotesReceivableLine`                   | Detects notes-receivable main accounts.                                                       | `CashAccountPolicy`.                                                                        |
| `isSettlementLine`                        | Detects settlement main accounts.                                                             | `CashAccountPolicy`.                                                                        |
| `filterOutSettlementLines`                | Removes settlement rows from ordinary line processing.                                        | `CashLineClassificationService`.                                                            |
| `getPaymentMethodName`                    | Maps voucher/payment type to D365FO payment method.                                           | `CashPaymentMethodPolicy`.                                                                  |
| `sanitizeInvoiceOutbound`                 | Normalizes outbound invoice identifiers.                                                      | `CashInvoiceService`.                                                                       |
| `isWithholdingLedgerLine`                 | Identifies withholding ledger rows.                                                           | `CashWithholdingService`.                                                                   |
| `firstFinancialTag`                       | Extracts the first FinTag segment.                                                            | `CashFinTagService`.                                                                        |
| `fetchVendorInvoiceExistsMap`             | Batch-loads vendor invoice existence from D365FO.                                             | `CashVendorInvoiceGateway` / `CashVendorInvoiceService`.                                    |
| `validateCashOutMarkedInvoice`            | Validates outbound marked invoice ownership and existence.                                    | `CashValidationService`.                                                                    |
| `buildMarkedLine`                         | Builds a line associated with a marked invoice.                                               | `CashDfoLineBuilder`.                                                                       |
| `formatInvoiceInbound`                    | Normalizes inbound invoice identifiers.                                                       | `CashInvoiceService`.                                                                       |
| `formatInvoiceOutbound`                   | Normalizes outbound invoice identifiers and prefixes.                                         | `CashInvoiceService`.                                                                       |
| `applyWithholdingReductions`              | Applies withholding reductions before grouping and line building.                             | `CashWithholdingService`.                                                                   |

## Proposed implementation order

1. Add characterization tests around the current public pipeline.
2. Extract stateless policies and serializers first: payment method, account classification, FinTag, invoice formatting, and dimension serialization.
3. Extract source validation and line classification.
4. Extract grouping, FX balance checks, withholding, settlements, and vendor payments.
5. Extract inbound/outbound line builders.
6. Move orchestration to `CashEntryPipelineService` and leave delegating methods in the base class.
7. Document every extracted function with input, output, side effects, and business-rule notes.

## Cash-In/Cash-Out processor boundaries

The first direction-separation step introduces two intermediate classes:

- `CashInEntryProcessor`: owns only the invariant `isInbound() === true`.
- `CashOutEntryProcessor`: owns only the invariant `isInbound() === false`.

The Freight and Trucking processors now extend the appropriate direction class
and retain their existing required-dimension configuration and `isTrucking()`
behavior. No transformation method, validation order, lookup, D365FO field,
or endpoint contract moved in this step.

## Required comment format for extracted functions

```ts
/**
 * What the function does in business terms.
 *
 * Important invariants:
 * - Input assumptions.
 * - Output shape and ordering.
 * - Error behavior and side effects.
 * - Business rules that must not change.
 */
```
