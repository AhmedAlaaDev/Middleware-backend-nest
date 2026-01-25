---
name: D365FO Update Conflict Analysis
overview: Analyze the D365FO OData update conflict error that occurs when posting Vendor Invoice Journal lines, explaining the root causes and why rollback sometimes fails with dependent lines errors.
todos: []
---

# D365FO Update Conflict Analysis

## Error Context

The error occurs during Vendor Invoice Journal posting to D365FO via OData:

- **Primary Error**: `Write failed for table row of type 'VendInvoiceJournalLineEntity'. Cannot edit a record in Ledger journal table (LedgerJournalTable). An update conflict occurred due to another user process deleting the record or changing one or more fields in the record.`
- **Secondary Error (Rollback)**: `Ledger journal table cannot be deleted while dependent Journal lines exist.`

## What This Error Means in D365FO Context

In D365FO, the `LedgerJournalTable` (journal header) and `VendInvoiceJournalLineEntity` (journal lines) have a tight relationship:

1. **Header State Management**: When lines are created/updated, D365FO automatically updates the header record (`LedgerJournalTable`) with:

   - Line counts
   - Total debit/credit amounts
   - Validation status
   - Other calculated fields

2. **Optimistic Concurrency Control**: D365FO uses optimistic locking with `RecVersion` (row version) fields. When a line write triggers a header update, it checks if the header's `RecVersion` matches the expected value. If another process modified the header, the write fails with an update conflict.

3. **Referential Integrity**: Headers cannot be deleted while dependent lines exist - this is enforced at the database level.

## Root Cause Analysis

Based on the codebase analysis in `src/modules/queue`, the most likely causes are:

### 1. **Concurrent Job Processing** (Most Likely)

**Location**: `src/modules/queue/processors/post-batch-dfo.processor.ts:48`

- The processor has `concurrency: 3`, allowing 3 jobs to run simultaneously
- If multiple jobs post to the same journal batch number or related journals, they can conflict

**Scenario**:

```
Job A: Creates Header H1 → Starts posting lines for H1
Job B: Creates Header H2 → Starts posting lines for H2 (but may reference H1 or same journal name)
Job C: Retries a failed job → Attempts to post lines to a header that Job A is modifying
```

**Conflict Point**: When Job A posts a line, D365FO updates the header's `RecVersion`. If Job C tries to post a line to the same header simultaneously, it sees a stale `RecVersion` and throws the conflict error.

### 2. **Partial Line Writes with Header State Mismatch**

**Location**: `src/modules/d365fo/services/vendor-invoice-journal.service.ts:51-108`

- Lines are posted sequentially using `postLinesForHeader`
- If a line write partially succeeds (e.g., line created but header update fails), the header state becomes inconsistent

**Scenario**:

```
Line 1 posted → Header updated (RecVersion = 2)
Line 2 posted → Header update attempted (expects RecVersion = 2)
  → But D365FO internal process (validation, workflow) changed header (RecVersion = 3)
  → Conflict: Expected RecVersion 2, but found 3
```

### 3. **D365FO Internal Processes Modifying Headers**

D365FO has background processes that can modify journal headers:

- **Workflow processes**: Approval workflows may update header status
- **Validation processes**: Automatic validation may update header fields
- **Batch processing**: D365FO batch jobs may process journals concurrently
- **User actions**: Manual edits in D365FO UI

**Scenario**:

```
Your process: Posts Line 5 → Triggers header update (RecVersion = 5)
D365FO workflow: Approves journal → Updates header (RecVersion = 6)
Your process: Posts Line 6 → Expects RecVersion 5, finds 6 → Conflict
```

### 4. **Retry Sending Same Line Again**

**Location**: `src/modules/queue/services/queue.service.ts:67-72`

- Failed jobs can be retried
- If a job partially succeeded (some lines posted), retrying may attempt to post the same lines again

**Scenario**:

```
Initial attempt: Lines 1-10 posted, Line 11 fails
Retry: Attempts to post lines 1-11 again
  → Lines 1-10 already exist → D365FO tries to update existing lines
  → Header RecVersion mismatch → Conflict
```

### 5. **Rollback Race Condition**

**Location**: `src/modules/queue/services/dfo-rollback.service.ts:238-454`

- Rollback deletes lines first, then headers
- If lines are being deleted while header deletion is attempted, timing issues occur

**Scenario**:

```
Rollback starts: Queries lines → Finds 5 lines
Rollback: Deletes lines 1-3 successfully
Rollback: Attempts to delete header
  → But lines 4-5 still exist (deletion in progress)
  → Error: "Cannot delete header while dependent lines exist"
```

The rollback code in `dfo-rollback.service.ts:334-432` has retry logic for this, but it may not catch all cases if:

- Line deletion is slow
- Multiple rollback processes run concurrently
- D365FO has internal locks on the header

## Code Evidence

### Concurrent Processing

```typescript:src/modules/queue/processors/post-batch-dfo.processor.ts
@Processor(QUEUES.DFO, {
  concurrency: 3, // Process 3 jobs concurrently
})
```

### Sequential Line Posting (No Retry)

```typescript:src/modules/d365fo/services/vendor-invoice-journal.service.ts
public async postLinesForHeader(
  headerKey: string,
  lines: D365FOVendorInvoiceJournalLineRequest[],
  chunkSize: number = 20,
): Promise<Array<{ headerId: string; lineNumber: number }>> {
  // Post lines sequentially within chunk (no parallel)
  for (const line of chunk) {
    try {
      await this.postLine(line); // No retry logic here
      // ...
    } catch (error) {
      throw new Error(...); // Immediate failure, no retry
    }
  }
}
```

### Rollback Retry Logic

```typescript:src/modules/queue/services/dfo-rollback.service.ts
// Step 3: Delete the header (with retry logic for dependent lines)
let headerDeleted = false;
let retryCount = 0;
const maxRetries = 2;

while (!headerDeleted && retryCount <= maxRetries) {
  try {
    await strategy.deleteHeader(header.headerKey, header.dataAreaId);
    // ...
  } catch (error: any) {
    const isDependentLinesError = /* checks for dependent lines error */;
    if (isDependentLinesError && retryCount < maxRetries) {
      // Query and delete remaining lines, then retry
    }
  }
}
```

## Most Likely Root Cause Ranking

1. **Concurrent job processing** (concurrency: 3) - Multiple jobs posting to same/related journals
2. **D365FO internal processes** - Workflow/validation modifying headers during line posting
3. **Partial writes with state mismatch** - Header RecVersion changes between line posts
4. **Retry sending duplicate lines** - Failed job retry attempting to post already-posted lines
5. **Rollback race condition** - Timing issues during line/header deletion

## Recommendations

1. **Add retry logic with exponential backoff** for line posting (similar to deletion)
2. **Reduce concurrency** or implement journal-level locking to prevent concurrent access to same journals
3. **Check for existing lines** before posting to avoid duplicate line conflicts
4. **Add delays between line posts** to allow D365FO internal processes to complete
5. **Improve rollback sequencing** with better synchronization between line and header deletion
6. **Implement idempotency checks** - track which lines were successfully posted to avoid re-posting on retry