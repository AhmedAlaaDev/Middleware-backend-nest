---
name: Vendor PostToDFO Implementation
overview: Implement a PostToDFO endpoint for vendor module that posts vendor invoice journal headers and lines to D365FO, following the same pattern as the accounts-receivable module.
todos:
  - id: "1"
    content: Create PostToDFODto in vendor/dtos
    status: completed
  - id: "2"
    content: Create PostVendorBatchToDFOCommand and result interface
    status: completed
  - id: "3"
    content: Create D365FO vendor invoice journal types (header and line requests)
    status: completed
  - id: "4"
    content: Create VendorInvoiceJournalService with post/delete methods
    status: completed
  - id: "5"
    content: Create PostVendorBatchToDFOHandler with grouping and mapping logic
    status: completed
  - id: "6"
    content: Extend queue processor to handle vendor journals
    status: completed
  - id: "7"
    content: Add PostToDFO endpoint to vendor controller
    status: completed
  - id: "8"
    content: Register handler in vendor module and service in d365fo module
    status: completed
---

# Vendor PostToDFO Implementation Plan

## Overview

Create a `PostToDFO` endpoint for the vendor module that mirrors the accounts-receivable implementation. The endpoint will post vendor invoice journal headers (`VendInvoiceJournalHeaders`) and lines (`VendInvoiceJournalLines`) to D365FO.

## Architecture

The implementation follows the same CQRS pattern as accounts-receivable:

```
Controller → Command → Handler → Queue → Processor → D365FO Service → D365FO API
```

## Files to Create/Modify

### 1. DTO

- **File**: `src/modules/vendor/dtos/post-to-dfo.dto.ts`
  - Create `PostToDFODto` class (can reuse the same structure as AR, just needs `batchId`)

### 2. Command

- **File**: `src/modules/vendor/commands/post-vendor-batch-to-dfo.command.ts`
  - Create `PostVendorBatchToDFOCommand` class
  - Create `PostVendorBatchToDFOResult` interface

### 3. Handler

- **File**: `src/modules/vendor/commands/handlers/post-vendor-batch-to-dfo.handler.ts`
  - Group enhanced records by `JOURNALBATCHNUMBER` (similar to AR grouping by `FreeTextNumber`)
  - Map vendor data to D365FO request types
  - Validate header and line data
  - Enqueue job to queue processor

### 4. D365FO Types

- **File**: `src/modules/d365fo/types/d365fo-vendor-invoice-journal.type.ts`
  - Create `D365FOVendorInvoiceJournalHeaderRequest` interface
  - Create `D365FOVendorInvoiceJournalLineRequest` interface
  - Map all fields from user-provided body structures

### 5. D365FO Service

- **File**: `src/modules/d365fo/services/vendor-invoice-journal.service.ts`
  - Create `VendorInvoiceJournalService` class
  - Implement `postHeader()` method (POST to `/data/VendInvoiceJournalHeaders`)
    - Returns response with `JournalBatchNumber`, `IsPosted`, `JournalTotalCredit`, `JournalTotalDebit` (these are not in request)
  - Implement `postLine()` method (POST to `/data/VendInvoiceJournalLines`)
    - Lines reference header via `JournalBatchNumber` (not `ParentRecId`)
    - Remove `FullPrimaryRemittanceAddress` from line body before posting
  - Implement `postHeadersBatch()` method (batch posting with chunking)
  - Implement `postLinesBatch()` method (batch posting with chunking)
  - Implement `deleteHeader()` method (for rollback)

### 6. Queue Processor

- **File**: `src/modules/queue/processors/post-batch-dfo.processor.ts`
  - Extend `PostBatchDFOJobData` interface to support vendor journals
  - Add logic to detect job type (AR vs Vendor)
  - Add vendor journal posting logic:
    - Post headers first (returns `JournalBatchNumber` in response)
    - Post lines with `JournalBatchNumber` already set (no need to update `ParentRecId` like AR)
    - Remove `FullPrimaryRemittanceAddress` from each line before posting
  - Handle vendor-specific rollback logic

### 7. Controller

- **File**: `src/modules/vendor/vendor.controller.ts`
  - Add `PostToDFO` endpoint (POST `/DataMigration/Vendor/PostToDFO`)
  - Use `PostToDFODto` for request body
  - Execute `PostVendorBatchToDFOCommand`

### 8. Module

- **File**: `src/modules/vendor/vendor.module.ts`
  - Add `PostVendorBatchToDFOHandler` to providers
  - Import `QueueModule` (if not already imported)

### 9. D365FO Module

- **File**: `src/modules/d365fo/d365fo.module.ts`
  - Add `VendorInvoiceJournalService` to providers
  - Export `VendorInvoiceJournalService`

### 10. Types Export

- **File**: `src/modules/d365fo/types/index.ts`
  - Export new vendor invoice journal types

## Key Implementation Details

### Data Grouping

- Group vendor enhanced records by `JOURNALBATCHNUMBER` field
- Each group represents one journal header with multiple lines
- Similar to AR's grouping by `FreeTextNumber`
- Lines connect to headers through `JournalBatchNumber` (not `ParentRecId` like AR)

### Mapping Logic

- Map from vendor DFO data interfaces (`IVendorFreightDFOLine`, `IVendorFreightDFOHeader`, etc.) to D365FO API request types
- Extract header information from first line in each group (or from `header` property if available)
- Map all required fields according to user-provided body structures
- **Note**: Header REQUEST body does NOT include `IsPosted`, `JournalTotalCredit`, or `JournalTotalDebit` fields (these are returned in the RESPONSE)
- Lines connect to headers via `JournalBatchNumber` field (not `ParentRecId` like AR invoices)
- Remove `FullPrimaryRemittanceAddress` from line body

### Validation

#### Header Validation

After mapping, validate that ALL header fields exist and are not empty/null:

- `dataAreaId` (required, string)
- `JournalBatchNumber` (required, string)
- `JournalName` (required, string)
- `OverrideSalesTax` (required, "Yes"/"No")
- `Description` (required, string)
- `SalesTaxIncluded` (required, "Yes"/"No")

#### Line Validation

After mapping, validate that ALL line fields exist and are not empty/null:

- `dataAreaId` (required, string)
- `JournalBatchNumber` (required, string)
- `LineNumber` (required, number)
- `AccountDisplayValue` (required, string)
- `PostingProfile` (required, string)
- `AccountType` (required, "Vend" or "Ledger")
- `Currency` (required, string)
- `Date` (required, ISO 8601 date string)
- `InvoiceDate` (required, ISO 8601 date string)
- `DueDate` (required, ISO 8601 date string)
- `Credit` or `Debit` (at least one must be > 0, both cannot be > 0)
- `ExchRate` (required, number)
- `TransactionType` (required, string)
- `OverrideSalesTax` (required, "Yes"/"No")
- `OffsetAccountType` (required, string)
- `OffsetAccountDisplayValue` (required, string)
- `OffsetCompany` (required, string)
- `DefaultDimensionDisplayValue` (required, string)
- `OffsetDefaultDimensionDisplayValue` (required, string)

### Queue Processing

- Use same queue (`QUEUES.DFO`) and processor (`PostBatchDFOProcessor`)
- Add job type detection to differentiate AR invoices from vendor journals
- Post headers first, then lines with proper `JournalBatchNumber` reference (lines connect via `JournalBatchNumber`, not `ParentRecId`)
- Handle errors and rollback (delete created headers if posting fails)

## Data Flow

1. **Controller** receives POST request with `batchId`
2. **Handler** validates batch, groups records by `JOURNALBATCHNUMBER`, maps to D365FO types
3. **Handler** enqueues job with grouped journals
4. **Queue Processor** posts headers in batches, then lines (lines reference headers via `JournalBatchNumber`)
5. **D365FO Service** makes HTTP POST requests to D365FO API
6. **Processor** updates batch status and stores created IDs

## Field Mappings

### Header Mapping (from vendor data to D365FO API)

Header body structure:

```json
{
    "dataAreaId": "m-p",
    "JournalBatchNumber": "Mesco-000001956",
    "JournalName": "V-Freight",
    "OverrideSalesTax": "No",
    "Description": "Vendor Invoice Freight January 2025",
    "SalesTaxIncluded": "Yes"
}
```

Mapping:

- `dataAreaId` → from company/batch company
- `JournalBatchNumber` → from `JOURNALBATCHNUMBER` (from first line in journal batch group)
- `JournalName` → from `JOURNALNAME` (from first line in journal batch group)
- `OverrideSalesTax` → from `OVERRIDESALESTAX` (convert to "Yes"/"No", from header or first line)
- `Description` → from `DESCRIPTION` (from header or first line)
- `SalesTaxIncluded` → from `SALESTAXINCLUDED` (convert to "Yes"/"No", from header or first line)

**Note**: Header REQUEST body does NOT include `IsPosted`, `JournalTotalCredit`, or `JournalTotalDebit` fields. These fields are returned in the RESPONSE:

```json
{
    "@odata.context": "...",
    "@odata.etag": "...",
    "dataAreaId": "m-p",
    "JournalBatchNumber": "Mesco-000099999",
    "JournalName": "V-Freight",
    "OverrideSalesTax": "No",
    "Description": "Vendor Invoice Freight January 2025",
    "IsPosted": "No",
    "SalesTaxIncluded": "Yes",
    "JournalTotalCredit": 0,
    "JournalTotalDebit": 0
}
```

### Line Mapping

- Map all fields from vendor line data to D365FO line request structure
- Ensure proper date formatting (ISO 8601)
- Handle optional fields appropriately
- Map dimension display values correctly
- **Important**: Lines connect to headers via `JournalBatchNumber` field (not `ParentRecId` like AR invoices)
- **Important**: Remove `FullPrimaryRemittanceAddress` from line body before posting

## Error Handling

- Validate batch exists before processing
- Validate all required fields are present
- Handle D365FO API errors gracefully
- Rollback created headers if line posting fails
- Update batch status and error messages appropriately