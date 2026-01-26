# LedgerJournalHeaders POST Payload Template

## Entity: LedgerJournalHeaders

### 1) REQUIRED FIELDS (POST)

- **dataAreaId**: Edm.String (Nullable=false) [Part of composite key - company identifier]
- **JournalBatchNumber**: Edm.String (Nullable=false) [Part of composite key - batch number, but has AllowEditOnCreate="false" annotation. See note below]
- **JournalName**: Edm.String (Nullable=true but IsRequired="true") [Required field, but AllowEdit="false" - may be set via journal setup]

**Note on JournalBatchNumber**: This field has `AllowEditOnCreate="false"` annotation, which is unusual for a key field. In practice:
- **Option A**: If the system auto-generates batch numbers, you may not need to send this (server generates it)
- **Option B**: If you must provide it, send it but it cannot be changed after creation

### 2) OPTIONAL WRITABLE FIELDS (POST)

- **Description**: Edm.String (Nullable=true) [Journal description/notes]
- **IntegrationKey**: Edm.String (Nullable=true) [Integration key for dual-write scenarios]

### 3) DO NOT SEND (READONLY/COMPUTED/SYSTEM)

- **AccountingCurrency**: Edm.String [AllowEdit="false", AllowEditOnCreate="false" - computed from journal setup]
- **PostingLayer**: Microsoft.Dynamics.DataEntities.CurrentOperationsTax [AllowEdit="false", AllowEditOnCreate="false" - system-managed]
- **IsPosted**: Microsoft.Dynamics.DataEntities.NoYes [AllowEdit="false", AllowEditOnCreate="false" - system status field]
- **JournalTotalCredit**: Edm.Decimal (Nullable=false) [AllowEdit="false", AllowEditOnCreate="false" - computed sum of line credits]
- **JournalTotalDebit**: Edm.Decimal (Nullable=false) [AllowEdit="false", AllowEditOnCreate="false" - computed sum of line debits]
- **LegalEntity**: NavigationProperty [Navigation property - do not send]
- **LedgerJournalLine**: NavigationProperty [Navigation property - do not send]

### 4) Minimal POST Payload Template (JSON)

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "JournalName": "GenJrn"
}
```

**Alternative if JournalBatchNumber is server-generated:**

```json
{
  "dataAreaId": "m-p",
  "JournalName": "GenJrn"
}
```

### 5) Recommended POST Payload Template (JSON)

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "JournalName": "GenJrn",
  "Description": "General journal entry for monthly closing"
}
```

**With IntegrationKey (for dual-write scenarios):**

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "JournalName": "GenJrn",
  "Description": "General journal entry for monthly closing",
  "IntegrationKey": "EXT-2025-01-26-001"
}
```

### Important Notes:

1. **JournalBatchNumber**: The metadata shows `AllowEditOnCreate="false"`, which suggests the system may auto-generate this. Test both approaches:
   - Include it if your system requires explicit batch numbers
   - Omit it if the system auto-generates batch numbers from the journal name

2. **JournalName**: Must reference an existing journal name configured in the system. This is typically set up in advance.

3. **dataAreaId**: This is the company/legal entity identifier (e.g., "m-p" for your company).

4. **Computed Fields**: Do not attempt to set `JournalTotalCredit`, `JournalTotalDebit`, `IsPosted`, or `AccountingCurrency` - these are calculated by the system based on the journal lines and status.
