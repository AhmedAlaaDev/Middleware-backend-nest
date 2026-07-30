# 📈 Accounts Receivable (AR) Module & Business Cycles

> **D365FO Middleware Backend — AR Domain, Processors & Invoicing Flows**  
> *Target Audience:* Finance (AR/Billing), Logistics Operations, Software Engineers.

---

## 1. Business Domain Overview

The **Accounts Receivable (AR)** module manages customer revenue billing for all logistics operations:
- **Sea & Air Freight Forwarding Invoices:** Billing clients for ocean container freight, air cargo charges, and port handling.
- **Inland Fleet / Trucking Invoices:** Billing clients for land container haulage and trucking trips.
- **Yard & Terminal Services Invoices:** Billing clients for container storage, demurrage, and yard gate fees.
- **Shipping Line Charges:** Billing shipping lines or co-loaders for agency and handling services.
- **Credit Notes:** Issuing adjustment vouchers for invoice corrections or client discounts.

---

## 2. AR Entry Processors & Business Scope

| Processor Class Name | `EntryProcessorTypes` | D365FO Target Entity | Real-World Business Context |
| :--- | :--- | :--- | :--- |
| `AccountReceivableFreightEntryProcessor` | `AccountReceivableFreight` | `FreeTextInvoiceHeaders` / `Lines` | Ocean & Air Freight Customer Invoices |
| `AccountReceivableFreightCreditNoteEntryProcessor` | `AccountReceivableFreightCreditNote` | `FreeTextInvoiceHeaders` / `Lines` | Freight Invoice Adjustment Credit Notes |
| `AccountReceivableTruckingEntryProcessor` | `AccountReceivableTrucking` | `FreeTextInvoiceHeaders` / `Lines` | Land Trucking & Transport Customer Invoices |
| `AccountReceivableTruckingCreditNoteEntryProcessor` | `AccountReceivableTruckingCreditNote` | `FreeTextInvoiceHeaders` / `Lines` | Trucking Invoice Credit Notes |
| `AccountReceivableYardEntryProcessor` | `AccountReceivableYard` | `FreeTextInvoiceHeaders` / `Lines` | Container Storage & Yard Fee Invoices |
| `AccountReceivableShippingLinesEntryProcessor` | `AccountReceivableShippingLines` | `FreeTextInvoiceHeaders` / `Lines` | Shipping Line Carrier Service Invoices |

---

## 3. Financial & Accounting Impact in D365FO

When an AR processor posts a batch to D365FO as a **Free Text Invoice**, the following accounting entries are created:

### Accounting Posting Entries:
- **DEBIT:** Customer Subledger Account (`CustAccount` e.g. `CUST-00192`)  
- **CREDIT:** Revenue Main Account (e.g., `410101` Freight Revenue or `410201` Trucking Revenue)  
- **CREDIT:** Sales Tax / VAT Payable Account (e.g. `220101` output VAT 14% if applicable)  

### Mandatory Financial Dimensions Enforced:
Each line item tagged on the Free Text Invoice header/line must contain valid financial dimensions:
- `MainAccount`: Revenue GL account code
- `BusinessUnit`: e.g. `BU-LOG` (Logistics)
- `CostCenters`: e.g. `CC-FRT` (Freight Ops) or `CC-FLEET` (Trucking Ops)
- `Activity`: Operational project code (e.g. `EXPORT-FCL`)
- `Location`: Branch code (e.g. `LOC-ALY`)
- `Customer`: Customer account code
- `SalesMan`: Salesperson ID responsible for commission tracking
- `CoordinatorMan`: Operations coordinator managing the shipment

---

## 4. End-to-End AR Business Cycle Flow

```
[Operational Manifest / Trip Sheet Completed in Excel]
                         │
                         ▼
           [API Endpoint: Upload AR Excel]
                         │
                         ▼
        [AccountReceivableFreightEntryProcessor]
     (Parses Dimensions, Validates Customer, FX Rate)
                         │
                         ▼
       [DataBatch Status: PENDING (Max 1000 Lines)]
                         │
                         ▼
           [BullMQ Queue: `dfo-free-text-invoice-queue`]
                         │
                         ▼
         [FreeTextInvoicePostingStrategy]
                         │
                         ▼
      [Post OData to D365FO `FreeTextInvoiceHeaders`]
                         │
                         ▼
         [D365FO Creates Posted Free Text Invoice]
     (Generates Invoice Number & Debits Customer Subledger)
                         │
                         ▼
            [Batch Status Set to COMPLETED]
```

### Detailed Step-by-Step Cycle Execution:
1. **Invoice Excel Upload:** Operations staff uploads customer billing sheets containing customer account numbers, bill of lading (B/L) numbers, charge descriptions, and amounts.
2. **Dimension Extraction:** The processor extracts dimensions from `ACCOUNTDISPLAYVALUE`.
3. **Customer & Tax Lookup:** The processor validates the customer account against D365FO master data cache and applies the appropriate `SALESTAXGROUP` (e.g., `VAT_14`).
4. **Exchange Rate Application:** For foreign currency billing (e.g., USD or EUR), transaction date exchange rates are retrieved from D365FO `ExchangeRates` service to calculate reporting currency equivalent in EGP.
5. **Queue Posting:** BullMQ dispatches the job to `dfo-free-text-invoice-queue`.
6. **OData Posting:** The strategy creates invoice headers in `FreeTextInvoiceHeaders` and line items in `FreeTextInvoiceLines`.
7. **Confirmation:** D365FO returns the assigned Invoice Number (e.g., `FTI-2026-00912`), updated in MongoDB batch records.
