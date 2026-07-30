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

---

## 5. Detailed Cash-In (Collections) Deep Dive

The **Cash-In** process manages the intake of customer collections. It translates operational receipts (cash, cheques, POS, bank transfers) into D365FO Customer Payment Journals (`Cust-Pay`).

### 5.1 The Business Lifecycle
1. **Receipt Generation:** A customer pays for a freight or trucking service. The cashier issues a receipt (Voucher) specifying the payment method, amount, currency, and the invoice being settled.
2. **Batch Upload:** At the end of the day or shift, the treasury team uploads an Excel sheet containing all receipts.
3. **Identification & Validation:** The system verifies the Customer Account against D365FO master data and ensures the referenced Invoice exists and is posted in D365FO.
4. **FX Gain/Loss Evaluation:** If the customer pays today for an invoice issued last month, the exchange rates likely differ. The system calculates the realized exchange gain or loss.
5. **Notes Receivable:** If the payment is made via post-dated cheques, it is classified under specific Notes Receivable ledger accounts instead of immediate cash bank accounts.
6. **ERP Settlement:** D365FO receives the data, debits the bank/cash account, credits the customer account, and settles (closes) the open invoice.

### 5.2 The Code & Logic Lifecycle
1. **Data Ingestion & SafeType Parsing:** 
   - The `CashInFreightEntryProcessor` processes rows.
   - It filters by `SafeType`. If `SafeType` is `Custody Settlement`, the line is extracted and redirected to the Custody Settlement logic. Only `Customer Collection` or `DownPayment` proceeds in the main Cash-In flow.
2. **Grouping by Invoice (UniqueId):**
   - Lines are grouped by a generated `UniqueId` representing the invoice group. Typically, a group consists of a debit line (Bank) and a credit line (Customer).
3. **Invoice Format Normalization:**
   - The `INVOICE` column is normalized to match D365FO's strict 9-digit format + suffix rule (e.g., `000012345/INVOICE` for import, `000012345/OF-FW` for export freight).
   - The processor validates that this invoice number exists and is fully posted in D365FO via a pre-validation query.
4. **Exchange Rate (FX) Calculation:**
   - The processor fetches the `EXCHANGERATESECONDARY` or the daily rate from the D365FO `ExchangeRates` endpoint.
   - It calculates the difference between the invoice's original EGP value and the payment's current EGP value.
   - Any difference creates an automated balancing line pointing to the FX Gain (`710101`) or FX Loss (`810101`) Main Account to ensure `Sum(Debit) == Sum(Credit)`.
5. **Notes Receivable Handling:**
   - If the offset line uses Ledger account types like `122201`, `122202`, etc., the system overrides the `OffsetAccountType` to `Bank` and sets the `PaymentMethod` to `NR` (Notes Receivable).
6. **Payload Construction:**
   - Maps the enriched group into `CustPaymentJournalHeaders` (the batch envelope) and `CustPaymentJournalLines` (the individual debits/credits).

---

## 6. Detailed Cash-Out (Disbursements) Deep Dive

The **Cash-Out** process governs the outflow of funds from the company to vendors, subcontractors, or employees (custody).

### 6.1 The Business Lifecycle
1. **Payment Requisition:** A vendor payment is approved, or an operational coordinator requests a cash advance (custody) for a trip's port fees.
2. **Disbursement:** The cashier releases the funds via bank transfer, cheque, or petty cash. The transaction is logged in the daily disbursement sheet.
3. **Tax & Withholding Deduction (WHT):** Before paying a vendor, Egyptian tax law often requires deducting a percentage (e.g., 1% or 3%) as Withholding Tax. The payment reflects the net amount.
4. **FX Adjustments:** If paying a foreign shipping line in USD, the rate paid today might differ from the rate when the vendor invoice was booked, resulting in an FX gain/loss.
5. **ERP Settlement:** D365FO records the disbursement, crediting the Bank/Cash account and debiting the Vendor Subledger (or the employee Custody account).

### 6.2 The Code & Logic Lifecycle
1. **Data Ingestion & SafeType Parsing:**
   - The `CashOutFreightEntryProcessor` processes rows.
   - It checks `SafeType` to distinguish between `Vendor Payment`, `Custody Issue`, and `Direct Expense`.
2. **Vendor Lookup & Validation:**
   - The `Vendor` dimension is extracted. The processor queries the Master Data cache for the vendor profile to ensure it is active and not blocked for payment.
3. **Withholding Tax (WHT) Automation:**
   - The processor checks the vendor's tax profile and the Excel `ITEMWITHHOLDINGTAXGROUPCODE` column.
   - If WHT applies, the processor automatically calculates the tax amount, reduces the vendor's net payable line, and adds a credit line to the WHT Payable Main Account.
4. **Exchange Rate (FX) Calculation:**
   - Similar to Cash-In, the processor fetches the daily exchange rate for the `TRANSDATE`.
   - It compares it against the original vendor bill rate, generating automatic FX Gain/Loss ledger lines to keep the voucher perfectly balanced.
5. **Payload Construction:**
   - The data is transformed into `LedgerJournalHeaders` (configured for AP Disbursement journals) and `LedgerJournalLines`.
   - Lines with `ACCOUNTTYPE = 'Vend'` hit the subledger, while `ACCOUNTTYPE = 'Bank'` record the outflow of cash.
