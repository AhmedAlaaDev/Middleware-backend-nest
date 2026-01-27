---
name: Free Text Invoice Fin Tag Update Service
overview: Create a new service to update FreeTextInvoiceFinTag in D365FO and integrate it into the AR batch posting flow. The service will be called after each header and its lines are successfully posted to update financial tags.
todos:
  - id: create-fin-tag-service
    content: Create FreeTextInvoiceFinTagService with updateFinTag method
    status: completed
  - id: update-handler-mapping
    content: Update handler to include HeaderDefaultDimensionDisplayValue and LineFinTagDisplayValue in grouped invoices
    status: completed
  - id: update-processor-fin-tag
    content: Update queue processor to call fin tag service after posting lines
    status: completed
  - id: register-service-module
    content: Register FreeTextInvoiceFinTagService in D365FOModule
    status: completed
  - id: verify-queue-module
    content: Verify queue module can access the new service
    status: completed
---

# Free Text Invoice Fin Tag Update Service

## Overview

Create a new service similar to `free-text-invoice.service.ts` that updates financial tags for free text invoices in D365FO. Integrate this service into the AR batch posting flow to update fin tags after headers and lines are successfully posted.

## Implementation Steps

### 1. Create Free Text Invoice Fin Tag Service

**File:** `src/modules/d365fo/services/free-text-invoice-fin-tag.service.ts`

- Create a new service class `FreeTextInvoiceFinTagService` following the pattern of `FreeTextInvoiceService`
- Inject `D365FOClientService` and `Logger`
- Implement `updateFinTag()` method that:
  - Accepts: `company`, `headerRecordId`, `headerDisplayValue`, and `lineDataString`
  - Calls endpoint: `/api/services/FreeTextInvoiceServiceGroup/FreeTextInvoiceFinTagService/update`
  - Uses `D365FOClientService.post()` method
  - Payload structure:
    ```typescript
    {
      "_contract": {
        "CompanyId": string,
        "HeaderRecordId": number,
        "HeaderDisplayValue": string,
        "LineDataString": string
      }
    }
    ```


### 2. Update Handler to Include Fin Tag Data

**File:** `src/modules/accounts-receivable/commands/handlers/post-ar-batch-to-dfo.handler.ts`

- Modify `mapToD365FORequests()` to include fin tag information in the grouped invoices structure
- Update the return type to include:
  - `HeaderDefaultDimensionDisplayValue` (already available from `firstLine.HeaderDefaultDimensionDisplayValue`)
  - `LineFinTagDisplayValue` array (extract from each line's `LineFinTagDisplayValue` field)
- Store these values alongside header and lines in the grouped invoices array

### 3. Update Queue Processor to Call Fin Tag Service

**File:** `src/modules/queue/processors/post-batch-dfo.processor.ts`

- Inject `FreeTextInvoiceFinTagService` in constructor
- After successfully posting lines for a header (around line 243), add a new step to update fin tags:
  - Format `LineDataString` as: `"[line1Number],[tag1Value];[line2Number],[tag2Value]"`
  - Use line numbers from `postedLines` array and `LineFinTagDisplayValue` from original grouped invoice data
  - Call `freeTextInvoiceFinTagService.updateFinTag()` with:
    - `company`
    - `headerKey` (as HeaderRecordId)
    - `HeaderDefaultDimensionDisplayValue` from grouped invoice
    - Formatted `LineDataString`
  - Handle errors gracefully - log but don't fail the entire posting if fin tag update fails

### 4. Update Module Registration

**File:** `src/modules/d365fo/d365fo.module.ts`

- Add `FreeTextInvoiceFinTagService` to `providers` array
- Add `FreeTextInvoiceFinTagService` to `exports` array

### 5. Update Queue Module (if needed)

**File:** `src/modules/queue/queue.module.ts`

- Ensure `D365FOModule` is imported so `FreeTextInvoiceFinTagService` is available
- Verify `FreeTextInvoiceFinTagService` can be injected into `PostBatchDFOProcessor`

## Data Flow

1. Handler groups invoices and maps them, including `HeaderDefaultDimensionDisplayValue` and `LineFinTagDisplayValue` for each line
2. Handler enqueues job with grouped invoices containing fin tag data
3. Queue processor posts header → posts lines → **updates fin tags** → moves to next header
4. Fin tag update uses:

   - Header ID from created header
   - `HeaderDefaultDimensionDisplayValue` from grouped invoice
   - Line numbers from `postedLines` array
   - `LineFinTagDisplayValue` from original line data

## Error Handling

- Fin tag update failures should be logged but not cause rollback of successfully posted headers/lines
- Consider adding error tracking for fin tag update failures separately from posting errors