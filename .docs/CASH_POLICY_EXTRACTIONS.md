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

- `is22420LedgerDimensionLine`
- `toCashDefaultDimensionDisplayValue`
- `resolveOffsetAccountDisplayValue`
- `dimensionPartAsString`
- `isNotesReceivableLine`
- `isSettlementLine`
- `sanitizeInvoiceOutbound`

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

Keeping these wrappers preserves subclass access and avoids changing the processor pipeline in one large operation. Future extractions should follow the same pattern: add characterization tests, move one deterministic responsibility, delegate from the base processor, and compare enhanced records/errors/payloads before and after.
