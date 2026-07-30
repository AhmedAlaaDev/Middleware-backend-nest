# 📉 Accounts Payable (AP) / Vendor Module & Business Cycles

> **D365FO Middleware Backend — Vendor AP Domain, Custody Filtering & Posting Flows**  
> *Target Audience:* Finance (AP/Disbursements), Subcontractor Management, Software Engineers.

---

## 1. Business Domain Overview

The **Accounts Payable (AP)** module manages vendor expenses and subcontractor payments:
- **Vendor Freight Invoices:** Sea shipping line freight bills, airline cargo bills, and co-loader invoices.
- **Vendor Fleet / Trucking Invoices:** Bills from third-party hired truck owners, transport subcontractors, and fleet suppliers.
- **Vendor Adjustments & Credit Notes:** Cost adjustments, demurrage settlements, and rebate credits.
- **Vendor Payments:** Payment disbursements, withholding tax retention, and bank transfer matching.

---

## 2. AP Entry Processors & Business Scope

| Processor Class Name | `EntryProcessorTypes` | D365FO Target Entity | Real-World Business Context |
| :--- | :--- | :--- | :--- |
| `VendorFreightEntryProcessor` | `VendorFreight` | `LedgerJournalHeaders` / `Lines` | Vendor Freight Bills (`LedgerJournalTable`) |
| `VendorFreightAdjustmentEntryProcessor` | `VendorFreightAdjustment` | `LedgerJournalHeaders` / `Lines` | Freight Vendor Invoice Cost Adjustments |
| `VendorTruckingEntryProcessor` | `VendorTrucking` | `LedgerJournalHeaders` / `Lines` | Hired Truck Owner & Subcontractor Bills |
| `VendorTruckingAdjustmentEntryProcessor` | `VendorTruckingAdjustment` | `LedgerJournalHeaders` / `Lines` | Fleet Vendor Adjustments |
| `VendorPaymentFreightEntryProcessor` | `VendorPaymentFreight` | Vendor Payment Journal | Freight Vendor Payment Disbursements |
| `VendorPaymentTruckingEntryProcessor` | `VendorPaymentTrucking` | Vendor Payment Journal | Fleet Subcontractor Payment Execution |

---

## 3. Critical Business Rules & Accounting Impact

### 🚫 1. Custody Account Exclusion Rule
In logistics, cash advances are often given to internal drivers or logistics coordinators for trip expenses. These internal advance accounts belong to the **Custody Vendor Group**.
- **Rule:** The vendor processors automatically scan lines. Any vendor account belonging to the **Custody** group is **EXCLUDED** from vendor bill posting (except for pure Ledger lines).
- **Reason:** Internal driver custody advances must NOT be booked as external vendor supplier liabilities—they are handled separately under Custody Settlement.

### 💰 2. Withholding Tax (WHT) Deduction
- When processing vendor invoices, the middleware checks if `ISWITHHOLDINGCALCULATIONENABLED` is true.
- It attaches `ITEMWITHHOLDINGTAXGROUPCODE` (e.g. `WHT_1%` or `WHT_3%`). Upon posting in D365FO, tax is deducted at source from the net payment payable to the vendor.

### 📊 Accounting Posting Entries (Vendor Invoice Journal):
- **DEBIT:** Cost / Expense Main Account (e.g., `510101` Ocean Freight Expense or `510201` Trucking Subcontractor Expense)  
- **CREDIT:** Vendor Subledger Account (`VendAccount` e.g. `VEND-00412`)  
- **CREDIT:** Withholding Tax Payable (Deducted at source)  

---

## 4. End-to-End AP Business Cycle Flow

```
[Vendor Supplier Invoices & Subcontractor Trip Sheets]
                         │
                         ▼
        [API Endpoint: Upload Vendor AP Excel]
                         │
                         ▼
           [VendorFreightEntryProcessor]
     (Applies Custody Filter, Looks up Vendor Tax ID)
                         │
                         ▼
       [DataBatch Status: PENDING (Max 1000 Lines)]
                         │
                         ▼
           [BullMQ Queue: `dfo-vendor-journal-queue`]
                         │
                         ▼
           [VendorJournalPostingStrategy]
                         │
                         ▼
    [Post OData to D365FO `LedgerJournalHeaders` / `Lines`]
                         │
                         ▼
        [D365FO Creates Posted Vendor Invoice Journal]
  (Generates Journal Batch Number & Credits Vendor Subledger)
                         │
                         ▼
            [Batch Status Set to COMPLETED]
```

### Detailed Step-by-Step Cycle Execution:
1. **Vendor Sheet Upload:** AP staff uploads vendor bills including vendor account numbers, supplier invoice numbers, tax IDs, due dates, and trip references.
2. **Custody Scanning:** Lines are checked against Custody vendor master data; any internal custody vendor lines are filtered out to prevent accounting distortion.
3. **Vendor Enrichment:** Master data service retrieves vendor tax registration numbers, payment terms, and posting profiles from D365FO cache.
4. **Voucher Grouping:** Lines sharing the same `VOUCHER` and `INVOICE` number are grouped into a single D365FO journal header.
5. **Queue & OData Posting:** Job is pushed to `dfo-vendor-journal-queue`. The strategy creates a `LedgerJournalHeaders` record and populates `LedgerJournalLines` with `ACCOUNTTYPE = 'Vend'`.
6. **Finalization:** D365FO confirms journal creation, recording batch numbers in MongoDB.
