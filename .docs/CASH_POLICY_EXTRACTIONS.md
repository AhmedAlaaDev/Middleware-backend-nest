# Cash Policy Extraction Documentation

## Why these files exist

`BaseCashEntryProcessor` currently performs the complete cash transformation pipeline. The first refactor step extracts small, deterministic rules into policy modules while leaving the base processor's protected methods and callers unchanged.

The business goal is to reduce the processor's size and isolate rules that must remain consistent across Cash-In/Cash-Out and Freight/Trucking. These files do not call D365FO, persist data, enqueue jobs, or change endpoint behavior.

## `cash-account.policy.ts`

Path: `src/modules/cash/policies/cash-account.policy.ts`

This file owns account classification and outbound invoice placeholder rules.

### Business rules

- Main accounts `122201`, `122202`, `122203`, `122204`, and `123510` are treated as notes receivable.
- Main account `421103` is treated as a settlement line.
- The special 22420 rule applies when either the ledger account or its FinTag begins with `22420`.
- Outbound invoice values that are blank or consist only of zeroes are treated as missing. Cash-In formatting is intentionally not reused here.

### Functions

- `isCash22420LedgerDimensionLine`: identifies whether either source/offset row is a ledger line affected by the 22420 dimension rule.
- `isCashNotesReceivableLine`: classifies a ledger row using the notes-receivable account list.
- `isCashSettlementLine`: classifies a ledger row using the settlement account list.
- `sanitizeCashOutboundInvoice`: removes blank and all-zero outbound invoice placeholders.

## `cash-dimension.policy.ts`

Path: `src/modules/cash/policies/cash-dimension.policy.ts`

This file owns the cash custom API's dimension serialization and offset-account selection.

### Business rules

- Cash custom APIs omit `mainAccount` from the default-dimension string.
- Dimension segments must remain in the existing fixed order because D365FO interprets them positionally.
- Missing `FreightType` defaults to `Payable` when the caller requests the default.
- Notes-receivable lines prefer the `bankAccount` dimension.
- Bank and petty-cash offsets use the source account display value.
- Other offsets use the source account when available and otherwise use the serialized dimension fallback.

### Functions

- `cashDimensionPartAsString`: normalizes supported string/number dimension values and rejects unsupported values.
- `toCashDefaultDimensionDisplayValue`: produces the positional cash API dimension string.
- `resolveCashOffsetAccountDisplayValue`: selects the D365FO offset account value according to account type and notes-receivable rules.

## Compatibility boundary

The following methods remain in `BaseCashEntryProcessor` as compatibility wrappers:

- `replaceFinTagShippingLineWithVendorName` (requires the base processor's vendor lookup)
- `formatInvoiceInbound` and `formatInvoiceOutbound` (the inbound pipeline now
  calls the extracted formatter directly; the wrappers remain temporarily for
  subclass/test compatibility)
- `applyWithholdingReductions` (temporarily retains only logging and returns
  the extracted policy statistics)

The `sanitizeInvoiceOutbound` and `firstFinancialTag` wrappers have now been
removed from `BaseCashEntryProcessor`; all internal callers use the extracted
policy functions directly. This is the model for removing the remaining
compatibility wrappers in later phases.

The account-classification and dimension-serialization wrappers have now also
been removed. Their callers use the policy functions directly, while the
22420 callers retain the shared dimension utility directly at the pipeline
boundaries.

## `cash-withholding.policy.ts`

Path: `src/modules/cash/policies/cash-withholding.policy.ts`

This file separates withholding classification from pipeline orchestration.
It preserves the rule that account `223304` is identified by source account
and that withholding statistics are grouped by voucher without mutating source
lines. SafeType-specific treatment remains in the processor because it
controls whether the amount belongs to vendor payment or custody settlement.

## `cash-invoice.policy.ts`

Path: `src/modules/cash/policies/cash-invoice.policy.ts`

This file begins the extraction of FinTag and invoice-identifier policies.
The current compatibility slice delegates the two FinTag operations from the
base processor; the inbound and outbound invoice formatters are documented
and staged in the same policy module for the next delegation step.

### Business rules

- The first FinTag segment is the operation number after invisible-character cleanup.
- Cash-Out shipping-line segment index `2` may be replaced by the vendor organization name when the vendor lookup succeeds.
- Inbound and outbound invoice formatting remain separate because they intentionally normalize source suffixes differently.

### Functions

- `firstCashFinancialTag`: extracts the normalized operation-number segment.
- `replaceCashShippingLineWithVendorName`: performs vendor-aware shipping-line replacement through a callback.
- `formatCashInboundInvoice`: staged Cash-In invoice normalization policy.
- `formatCashOutboundInvoice`: staged Cash-Out invoice normalization policy.

`filterLines` has now been removed from the base processor because the active
pipeline uses `classifyCashLines` directly. The legacy unique-ID helper remains
temporarily until its final external-reference check is complete.

The unique-ID compatibility helper has now also been removed. The active
pipeline uses `assignCashMissingUniqueIds` directly, and repository reference
search confirms no remaining Cash callers use the old method.

## `cash-journal.policy.ts`

Path: `src/modules/cash/policies/cash-journal.policy.ts`

This file centralizes journal-name and product-label rules. Cash-In resolves to
`Cust-Pay`; Cash-Out uses the routed journal and preserves `P-Freight` and
`P-Fleet` fallbacks. The policy receives the existing routing callback so
SafeType resolution and validation remain in the current routing service.

The batch-policy tests verify voucher-ID assignment, preservation of existing
IDs, Cash-In custody splitting, and Cash-Out line retention before the legacy
base helpers are removed.

## `cash-normalization.policy.ts`

Path: `src/modules/cash/policies/cash-normalization.policy.ts`

`mapCashRawData` is now the active raw-row mapping boundary. It receives the
explicit Freight/Fleet product and inbound/outbound direction, preserves input
order, and constructs the same `CashEntryRawDataModel` instances previously
created by the base processor. Its focused test verifies order and outbound
direction metadata.

## `cash-batch.policy.ts`

Path: `src/modules/cash/policies/cash-batch.policy.ts`

This file separates upload-pipeline grouping rules:

- `assignCashMissingUniqueIds` derives deterministic IDs from vouchers only
  when source IDs are missing.
- `classifyCashLines` keeps Cash-Out rows together and separates Cash-In
  custody-settlement rows while preserving encounter order.

The upload pipeline now calls these policy functions directly. The old base
methods remain temporarily as compatibility helpers for existing subclasses
and scripts; they are not part of the active pipeline.

Keeping these wrappers preserves subclass access and avoids changing the processor pipeline in one large operation. Future extractions should follow the same pattern: add characterization tests, move one deterministic responsibility, delegate from the base processor, and compare enhanced records/errors/payloads before and after.

## `cash-line.policy.ts`

Path: `src/modules/cash/policies/cash-line.policy.ts`

This file owns two source-line rules shared by Cash-In and Cash-Out:

- `filterCashSettlementLines` separates account `421103` settlement rows while preserving source order and delegates dimension parsing to the existing processor utility.
- `resolveCashPaymentMethod` selects the source payment method from the transaction row first, then the paired row; it never infers a method from account type.

The corresponding helper implementations have been removed from the base processor. The policy receives parsing as a callback so it remains free of processor state and D365FO dependencies.
