# Customer Tax Number Audit Report

Generates a self-contained, A4-printable HTML report that audits the local MongoDB
customer master data for duplicate and missing tax numbers.

## Purpose

Our local MongoDB mirrors synced D365FO customers. Tax numbers (`taxExemptNumber`)
must be unique per customer record. When multiple customers share the same tax number,
the middleware cannot reliably resolve a single customer during AR processing.

This script detects:

- **Duplicate tax numbers** — same normalised `taxExemptNumber` used by more than one customer.
- **Missing tax numbers** — customers where `taxExemptNumber` is `null`, empty, whitespace-only, or a known placeholder (`N/A`, `NA`, `-`, `--`, `0`).

## Required Environment Variable

```
MONGODB_URI=<your MongoDB connection string>
```

The script loads this from the same env files the backend uses, in this order:

1. `.env.<NODE_ENV>` (e.g. `.env.development`)
2. `.env.local`
3. `.env`

## Command

Run from the project root (`D365FOMiddleware_Nestbackend/`):

```bash
pnpm customer-tax-audit
```

## Output

```
reports/customer-tax-audit-report.html
```

The `reports/` folder is created automatically if it does not exist.

## CLI Summary Output

```
── Report Summary ───────────────────────────────────────
  Total customers scanned       : 1,234
  Duplicate tax numbers          : 7
  Duplicate customer accounts    : 17
  Missing tax number customers   : 42
─────────────────────────────────────────────────────────
  Report written to : /path/to/reports/customer-tax-audit-report.html
```

## How to Print / Save as PDF

1. Open the generated `reports/customer-tax-audit-report.html` in any modern browser
   (Chrome, Edge, Firefox).
2. Use **File → Print** (or `Ctrl+P` / `Cmd+P`).
3. Set:
   - **Destination**: Save as PDF
   - **Paper size**: A4
   - **Orientation**: Portrait
   - **Margins**: Default (the report uses `@page` CSS margins)
   - **Background graphics**: On (for table shading — optional; the report is
     designed to read clearly in black-and-white even without background graphics)
4. Click **Save**.

## Safety Guarantees

- **Read-only**: The script runs aggregation and `find` queries only. It does not
  call `updateOne`, `deleteOne`, `insertOne`, `bulkWrite`, or any write operation.
- **No D365FO API calls**: The script connects only to local MongoDB.
- **No NestJS runtime**: The script runs standalone via `ts-node`.

## Limitations — Movement Detection

Movement status is currently reported as **"Unknown — not enough local data"** for
all customers. The local `data_enhanced_records` and `data_source_records` collections
store payloads in a generic `data: Record<string, any>` field whose structure varies
by entry-processor type and cannot be reliably queried without type-specific logic.

Finance should verify movement status directly in D365FO (Accounts Receivable →
Customers → Customer Transactions) before requesting any removal or deactivation.
