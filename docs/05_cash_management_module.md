# 💵 Cash & Bank Management Module & Business Cycles

> **D365FO Middleware Backend — Cash Receipts, Disbursements & FX Balancing**  
> *Target Audience:* Treasury, Cash Office, AR/AP Collections, Software Engineers.

---

## 1. Business Domain Overview

The **Cash & Bank Management** module handles all treasury and liquidity transactions:
- **Cash-In (Collections & Receipts):** Recording customer payments, bank deposits, down payments, and wire receipts for freight and fleet trucking services.
- **Cash-Out (Disbursements & Advances):** Recording vendor payments, bank transfers, petty cash disbursements, and driver operational cash advances.
- **FX Exchange Rate Balancing:** Adjusting foreign currency receipts/payments against original invoice exchange rates to record realized foreign exchange gains or losses.
- **Custody Settlement Routing:** Isolating custody advance settlements and routing them to dedicated clearing journals.

---

## 2. Cash Entry Processors & Business Scope

| Processor Class Name | `EntryProcessorTypes` | D365FO Target Entity | Real-World Business Context |
| :--- | :--- | :--- | :--- |
| `CashInFreightEntryProcessor` | `CashInFreight` | `CustPaymentJournalHeaders` / `Lines` | Customer Payment Receipts (Freight) |
| `CashInTruckingEntryProcessor` | `CashInTrucking` | `CustPaymentJournalHeaders` / `Lines` | Customer Payment Receipts (Trucking) |
| `CashOutFreightEntryProcessor` | `CashOutFreight` | Disbursement Journal | Vendor & Cash Disbursements (Freight) |
| `CashOutTruckingEntryProcessor` | `CashOutTrucking` | Disbursement Journal | Vendor & Cash Disbursements (Trucking) |

---

## 3. Financial & Accounting Impact in D365FO

### 📥 Cash-In (Customer Collection Journal - `Cust-Pay`):
- **DEBIT:** Bank / Cash Main Account (e.g., `110201` CIB EGP Bank or `110202` USD Bank)  
- **CREDIT:** Customer Subledger Account (`CustAccount` e.g. `CUST-00192`)  
- **DEBIT/CREDIT (FX Difference):** Realized FX Gain/Loss Account (e.g., `710101` / `810101`) if invoice FX rate differs from payment date FX rate.

### 📤 Cash-Out (Vendor Disbursement Journal):
- **DEBIT:** Vendor Subledger Account (`VendAccount` e.g. `VEND-00412`) or Expense/Custody Account  
- **CREDIT:** Bank / Cash Main Account  

---

## 4. End-to-End Cash Business Cycle Flow

```
[Bank Statements / Cash Office Receipt Vouchers]
                        │
                        ▼
      [API Endpoint: Upload Cash Receipts Excel]
                        │
                        ▼
           [CashInFreightEntryProcessor]
   (Parses Bank Accounts, Customer IDs, FX Differences)
                        │
                        ▼
      [DataBatch Status: PENDING (Max 1000 Lines)]
                        │
                        ▼
       [BullMQ Queue: `dfo-customer-payment-journal-queue`]
                        │
                        ▼
        [CustomerPaymentPostingStrategy]
                        │
                        ▼
   [Post OData to D365FO `CustPaymentJournalHeaders`]
                        │
                        ▼
       [D365FO Posts Customer Payment Journal]
 (Clears Open Invoice & Balances Bank/Customer Subledgers)
                        │
                        ▼
           [Batch Status Set to COMPLETED]
```

### Detailed Step-by-Step Cycle Execution:
1. **Cash Sheet Upload:** Cashier or treasury accountant uploads daily collection logs containing bank account codes, customer codes, payment amounts, and invoice reference numbers.
2. **Custody Split:** Any lines marked as driver custody settlements are separated and routed to the custody settlement workflow.
3. **FX Calculation:** If a customer pays in USD for an invoice originally issued in USD but recorded in EGP, the system fetches transaction date exchange rates to balance net GL amounts.
4. **Queue Posting:** Dispatched to `dfo-customer-payment-journal-queue`.
5. **OData Execution:** Posts header and line records into D365FO customer payment journal.
6. **Subledger Settlement:** D365FO applies the cash receipt against open customer invoices, updating customer balance.
