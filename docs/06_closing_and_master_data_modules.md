# 🏁 Closing & Master Data Modules & Business Cycles

> **D365FO Middleware Backend — Month-End Period Closing & System Master Data**  
> *Target Audience:* Chief Accountants, Financial Controllers, Enterprise Architects.

---

## 1. Closing Module Business Overview

The **Closing** module manages period-end accounting entries and General Ledger (GL) reconciliations:
- **Freight Period Closing (`GL-Freight`):** Adjusting revenue/expense accruals and clearing ocean/air freight transit main accounts at month-end.
- **Fleet/Trucking Period Closing (`GL-Fleet`):** Reconciling fleet fuel, driver trip allowances, truck maintenance accruals, and hired truck owner settlements.
- **Freight Difference Adjustments:** Allocating exchange rate differences and tariff rounding variances.
- **Custody Settlement Entries:** Reconciling employee/driver custody advance clearing accounts against verified trip receipts.

---

## 2. Closing Entry Processors & Business Scope

| Processor Class Name | `EntryProcessorTypes` | D365FO Target Journal | Real-World Business Purpose |
| :--- | :--- | :--- | :--- |
| `ClosingFreightEntryProcessor` | `LedgerFreightClosingEntry` | `GL-Freight` Journal | Month-End Freight Revenue/Expense GL Closing |
| `ClosingTruckingEntryProcessor` | `LedgerTruckingClosingEntry` | `GL-Fleet` Journal | Month-End Fleet & Trucking GL Closing |
| `ClosingFreightDifferenceEntryProcessor` | `LedgerClosingFreightDifference` | `GL-Freight` Journal | Period Freight Variance & FX Differences |
| `ClosingCustodySettlementEntryProcessor` | `LedgerCustodySettlementEntry` | Custody GL Journal | Driver & Employee Custody Clearing |

---

## 3. Financial & Accounting Impact in D365FO

### ⚖️ Period Closing Journal (`LedgerJournalHeaders`):
- **DEBIT / CREDIT:** Expense Accrual Main Accounts (e.g. `510901` Freight Accruals)  
- **DEBIT / CREDIT:** Clearing Main Accounts (e.g. `110901` Transit Clearing)  
- **Voucher Balance Requirement:** Total Debits MUST strictly equal Total Credits (`Sum(Debit) == Sum(Credit)`) for every voucher. Imbalanced vouchers are rejected before submission.

---

## 4. Master Data Module Overview

The **Master Data** module provides centralized caching and synchronization for D365FO enterprise entities:

### Key Master Data Services:
1. **Financial Dimensions Service:** Validates and caches the 15 financial dimension tags (`MainAccount`, `BusinessUnit`, `CostCenters`, `Activity`, `Location`, `SalesMan`, `CoordinatorMan`, `Direction`, `Vendor`, `SubVendor`, `Worker`, `TruckerType`, `TruckNumber`).
2. **Main Accounts Cache:** Stores chart of accounts definitions, account types (`Ledger`, `Cust`, `Vend`, `Bank`), and posting restrictions.
3. **Exchange Rates Service:** Fetches monthly and daily exchange rates for `USD` and `EUR` to `EGP`, ensuring precise reporting currency conversions.
4. **Tax & WHT Service:** Caches Sales Tax Groups (`VAT_14`) and Withholding Tax rules (`WHT_1%`, `WHT_3%`).

---

## 5. End-to-End Closing Business Cycle Flow

```
[Month-End Accounting Cut-off Reconciled by Finance]
                         │
                         ▼
        [API Endpoint: Upload Closing GL Excel]
                         │
                         ▼
           [ClosingFreightEntryProcessor]
     (Verifies Voucher Balance: Sum(Debit) == Sum(Credit))
                         │
                         ▼
       [DataBatch Status: PENDING (Max 1000 Lines)]
                         │
                         ▼
           [BullMQ Queue: `dfo-ledger-journal-queue`]
                         │
                         ▼
            [LedgerJournalPostingStrategy]
                         │
                         ▼
     [Post OData to D365FO `LedgerJournalHeaders`]
                         │
                         ▼
     [D365FO Creates Posted General Ledger Journal]
      (Posts to `GL-Freight` or `GL-Fleet` Journal)
                         │
                         ▼
            [Batch Status Set to COMPLETED]
```

### Detailed Step-by-Step Cycle Execution:
1. **Closing Sheet Preparation:** Accounting team prepares month-end journal entries in Excel.
2. **Strict Balance Audit:** The processor verifies that every voucher balances to zero (`Sum(Debit) - Sum(Credit) == 0`). If an imbalance exists, the upload fails immediately with line references.
3. **Queue Submission:** Dispatched to `dfo-ledger-journal-queue`.
4. **OData Execution:** Posts header and line records into D365FO `LedgerJournalHeaders` for journal names `GL-Freight` or `GL-Fleet`.
5. **Period Finalization:** D365FO posts the general ledger journal, completing month-end closing.
