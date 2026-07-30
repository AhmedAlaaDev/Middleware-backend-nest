# 📖 Master Reference Dictionary: Key Names, Terminology & Concepts

> **D365FO Middleware Backend — Essential Keywords & Reference Guide**  
> *Target Audience:* New Developers, Business Analysts, Integration Engineers, and Finance Ops.  
> *Purpose:* Master dictionary of all critical business terms, processor class names, D365FO OData entities, financial dimensions, background queue names, Excel column headers, status codes, and environment variables.

---

## 1. Key Business & Accounting Keywords

| Keyword / Term | Business Definition | Real-World & Accounting Context |
| :--- | :--- | :--- |
| **D365FO** | **Microsoft Dynamics 365 Finance & Operations** | The central Enterprise Resource Planning (ERP) system of record for financial accounting, subledgers, general ledger, and legal entities. |
| **Middleware** | **NestJS Integration Tier** | The backend service (this project) that sits between operational Excel files/internal apps and D365FO to validate, enrich, batch, and asynchronously post transactions. |
| **Free Text Invoice (FTI)** | **Customer Direct Invoice** | A D365FO sales invoice created without a sales order line item, used to bill customers directly for logistics services (Freight, Trucking, Yard). |
| **Vendor Invoice Journal** | **AP Bill Entry (`LedgerJournalHeaders`)** | A D365FO journal used to record vendor bills and supplier expenses (e.g. shipping line freight charges, subcontractor trucking fees). |
| **General Ledger (GL) Journal** | **Direct Journal Entry** | A journal used for manual adjustments, period-end closing entries, custody settlement, and internal allocation between ledger main accounts. |
| **Customer Payment Journal (`Cust-Pay`)** | **AR Receipts & Collections** | A D365FO journal used to post customer payments, receipts, down payments, and bank deposit matching against open invoices. |
| **Custody Settlement** | **Driver/Employee Advance Reconciliation** | Operational cash advanced to drivers or logistics coordinators for trip expenses (fuel, tolls, port fees) that must be settled against actual receipts. |
| **Credit Note** | **Invoice Reversal / Adjustment** | A document issued to reduce the amount owed by a customer or owed to a vendor due to billing corrections, price disputes, or returns. |
| **Financial Dimensions** | **Multi-Segment Accounting Tagging** | A set of tracking codes attached to ledger transactions (e.g. Business Unit, Cost Center, Activity, Salesman, Location) for managerial reporting. |
| **Posting Profile** | **D365FO Subledger Link** | A configuration in D365FO that controls which Summary Main Account is debited/credited when posting customer or vendor transactions. |
| **Withholding Tax (WHT)** | **Tax Deducted at Source** | Tax retained from vendor payments and remitted directly to tax authorities according to local tax regulation. |
| **Sales Tax / VAT Group** | **Tax Calculation Matrix** | D365FO tax codes determining the applicable Value Added Tax rate for items, services, customers, and vendors. |
| **Exchange Rate (FX)** | **Currency Rate Matching** | Multi-currency conversion rates (USD/EUR to EGP) calculated on transaction dates to record foreign currency transactions and FX gains/losses. |

---

## 2. All 28 Entry Processor Types (`EntryProcessorTypes`) & Class Names

Every Excel workbook uploaded into the middleware corresponds to an **Entry Processor**. Below is the complete list of all 28 registered entry processor enum values and their matching NestJS class names in the code:

| Enum Key (`EntryProcessorTypes`) | NestJS Class Name | Target D365FO Document / Journal | Business Domain |
| :--- | :--- | :--- | :--- |
| `AccountReceivableFreight` | `AccountReceivableFreightEntryProcessor` | Free Text Invoice (`CustInvoiceTable`) | Accounts Receivable (Freight) |
| `AccountReceivableFreightCreditNote` | `AccountReceivableFreightCreditNoteEntryProcessor` | Free Text Invoice (Credit Note) | Accounts Receivable (Freight) |
| `AccountReceivableTrucking` | `AccountReceivableTruckingEntryProcessor` | Free Text Invoice (`CustInvoiceTable`) | Accounts Receivable (Trucking) |
| `AccountReceivableTruckingCreditNote` | `AccountReceivableTruckingCreditNoteEntryProcessor` | Free Text Invoice (Credit Note) | Accounts Receivable (Trucking) |
| `AccountReceivableYard` | `AccountReceivableYardEntryProcessor` | Free Text Invoice (`CustInvoiceTable`) | Accounts Receivable (Yard) |
| `AccountReceivableShippingLines` | `AccountReceivableShippingLinesEntryProcessor` | Free Text Invoice (`CustInvoiceTable`) | Accounts Receivable (Carriers) |
| `VendorFreight` | `VendorFreightEntryProcessor` | Vendor Invoice Journal (`LedgerJournalTable`) | Accounts Payable (Freight) |
| `VendorFreightAdjustment` | `VendorFreightAdjustmentEntryProcessor` | Vendor Invoice Journal (`LedgerJournalTable`) | Accounts Payable (AP Adjustment) |
| `VendorTrucking` | `VendorTruckingEntryProcessor` | Vendor Invoice Journal (`LedgerJournalTable`) | Accounts Payable (Fleet/Trucking) |
| `VendorTruckingAdjustment` | `VendorTruckingAdjustmentEntryProcessor` | Vendor Invoice Journal (`LedgerJournalTable`) | Accounts Payable (AP Adjustment) |
| `VendorPaymentFreight` | `VendorPaymentFreightEntryProcessor` | Vendor Payment Journal | Accounts Payable (Vendor Pay) |
| `VendorPaymentTrucking` | `VendorPaymentTruckingEntryProcessor` | Vendor Payment Journal | Accounts Payable (Vendor Pay) |
| `CashInFreight` | `CashInFreightEntryProcessor` | Customer Payment Journal (`Cust-Pay`) | Cash & Banking (Freight Receipts) |
| `CashOutFreight` | `CashOutFreightEntryProcessor` | Vendor/Cash Disbursement Journal | Cash & Banking (Freight Pay) |
| `CashInTrucking` | `CashInTruckingEntryProcessor` | Customer Payment Journal (`Cust-Pay`) | Cash & Banking (Fleet Receipts) |
| `CashOutTrucking` | `CashOutTruckingEntryProcessor` | Vendor/Cash Disbursement Journal | Cash & Banking (Fleet Pay) |
| `LedgerFreightClosingEntry` | `ClosingFreightEntryProcessor` | GL Adjustment Journal (`GL-Freight`) | Month-End Period Closing |
| `LedgerClosingFreightDifference` | `ClosingFreightDifferenceEntryProcessor` | GL Adjustment Journal (`GL-Freight`) | Month-End Period Closing |
| `LedgerTruckingClosingEntry` | `ClosingTruckingEntryProcessor` | GL Adjustment Journal (`GL-Fleet`) | Month-End Period Closing |
| `LedgerCustodySettlementEntry` | `ClosingCustodySettlementEntryProcessor` | GL Custody Settlement Journal | Month-End Custody Clearing |
| `AccountReceivableClearance` | *(Reserved for Clearance AR)* | Free Text Invoice | Accounts Receivable (Customs) |
| `VendorClearance` | *(Reserved for Clearance AP)* | Vendor Invoice Journal | Accounts Payable (Customs) |
| `VendorPaymentClearance` | *(Reserved for Clearance Pay)* | Vendor Payment Journal | Accounts Payable (Customs) |
| `CashInClearance` | *(Reserved for Clearance Cash-In)* | Customer Payment Journal | Cash & Banking |
| `CashOutClearance` | *(Reserved for Clearance Cash-Out)*| Disbursement Journal | Cash & Banking |
| `LedgerClearanceClosingEntry` | *(Reserved for Clearance Closing)*| GL Journal | Month-End Period Closing |
| `MasterDataSync` | `MasterDataSyncProcessor` | N/A (Internal Mongo/Redis Sync) | Master Data System Sync |
| `CustodySettlement` | `CustodySettlementProcessor` | GL Custody Journal | Custody Management |

---

## 3. The 15 Financial Dimension Names

Financial dimensions in D365FO map to the pipe-separated string `ACCOUNTDISPLAYVALUE` (e.g. `MainAccount|BusinessUnit|CostCenter|Activity|Location...`).

| Dimension Key | Business Meaning | Example Values |
| :--- | :--- | :--- |
| `MainAccount` | General Ledger Main Chart of Account Number | `410101` (Revenue), `510101` (Direct Cost), `110201` (Bank) |
| `BusinessUnit` | High-level organizational division | `BU-LOG` (Logistics), `BU-FWD` (Freight Forwarding) |
| `CostCenters` | Operating cost center / department | `CC-FLEET` (Fleet Ops), `CC-ADMIN` (Administration) |
| `Activity` | Specific operational project or job activity | `ACT-EXPORT`, `ACT-IMPORT`, `ACT-CLEARANCE` |
| `Location` | Branch or port location code | `LOC-CAI` (Cairo), `LOC-ALY` (Alexandria Port), `LOC-SZX` |
| `Customer` | Customer account identifier tag | `CUST-00192` |
| `SubCustomer` | Subsidiary customer or sub-billing account | `SUBCUST-01` |
| `ChargeType` | Nature of freight/logistics charge | `CHG-OCEAN` (Ocean Freight), `CHG-STORAGE` (Demurrage) |
| `SalesMan` | Sales representative responsible for the account | `EMP-9021` |
| `CoordinatorMan` | Logistics operation coordinator managing the job | `EMP-4012` |
| `FreightType` | Mode of freight transportation | `FRL` (FCL Ocean), `LCL` (LCL Ocean), `AIR` (Air Freight) |
| `Direction` | Shipping direction | `IMPORT`, `EXPORT`, `DOMESTIC` |
| `Vendor` | Vendor account tag associated with line cost | `VEND-00412` |
| `SubVendor` | Subcontractor / sub-supplier identifier | `SUBVEND-09` |
| `Worker` | Driver or operational employee identifier | `WRK-5510` |
| `TruckerType` | Fleet ownership category (Trucking only) | `OWNED` (Company Fleet), `HIRED` (Third-party Subcontractor) |
| `TruckNumber` | Vehicle License Plate / Fleet Unit ID (Trucking) | `TRK-9821-EGP` |

---

## 4. D365FO OData Entity Names & Endpoints

| D365FO OData Entity Name | Target API Endpoint URI | Document Created in D365FO |
| :--- | :--- | :--- |
| `FreeTextInvoiceHeaders` | `/data/FreeTextInvoiceHeaders` | Free Text Invoice Header (`CustInvoiceTable`) |
| `FreeTextInvoiceLines` | `/data/FreeTextInvoiceLines` | Free Text Invoice Line Items (`CustInvoiceLine`) |
| `LedgerJournalHeaders` | `/data/LedgerJournalHeaders` | Journal Header for AP Vendor Bills & GL Journals |
| `LedgerJournalLines` | `/data/LedgerJournalLines` | Journal Line Items (Vendor & Ledger Lines) |
| `CustPaymentJournalHeaders` | `/data/CustPaymentJournalHeaders` | Customer Payment Journal Header |
| `CustPaymentJournalLines` | `/data/CustPaymentJournalLines` | Customer Payment Journal Lines |
| `Vendors` | `/data/Vendors` | Master Data: Vendor Profiles, Tax IDs, Terms |
| `Customers` | `/data/Customers` | Master Data: Customer Profiles, Tax IDs, Credit Terms |
| `MainAccounts` | `/data/MainAccounts` | Master Data: Chart of Accounts Definitions |
| `ExchangeRates` | `/data/ExchangeRates` | Master Data: Daily/Monthly Currency Exchange Rates |

---

## 5. BullMQ Background Processing Queues

| Queue Name Constant | Redis Queue Name | Purpose & Handler Strategy |
| :--- | :--- | :--- |
| `DFO_FREE_TEXT_INVOICE_QUEUE` | `dfo-free-text-invoice-queue` | Posts Customer Free Text Invoices (AR Freight, Trucking, Yard, Shipping Lines). |
| `DFO_VENDOR_JOURNAL_QUEUE` | `dfo-vendor-journal-queue` | Posts Vendor Invoice Journals (AP Freight, Fleet Trucking Bills). |
| `DFO_LEDGER_JOURNAL_QUEUE` | `dfo-ledger-journal-queue` | Posts General Ledger Closing entries (`GL-Freight`, `GL-Fleet`, Custody Settlement). |
| `DFO_CUSTOMER_PAYMENT_JOURNAL_QUEUE` | `dfo-customer-payment-journal-queue` | Posts Customer Payments & Cash Receipts (`Cust-Pay`). |
| `MASTER_DATA_SYNC_QUEUE` | `master-data-sync-queue` | Runs background synchronization of D365FO master data into Mongo/Redis. |

---

## 6. Key Excel Input File Headers & Fields

| Excel Field Name | Data Type | Mandatory? | Business Description |
| :--- | :--- | :--- | :--- |
| `LINENUMBER` | Number | Yes | Sequential row line index within the Excel workbook. |
| `JOURNALBATCHNUMBER` | String | No | Target batch number if referencing an existing journal. |
| `JOURNALNAME` | String | Varies | Journal code (e.g. `GL-Freight`, `Cust-Pay`, `AP-Vend`). |
| `VOUCHER` | String | Yes | Unique voucher grouping code. Lines with identical vouchers belong to 1 transaction. |
| `TRANSDATE` | Date (`YYYY-MM-DD`)| Yes | Financial transaction date used for period determination and exchange rates. |
| `ACCOUNTTYPE` | String | Yes | Account category: `Ledger`, `Cust`, `Vend`, `Bank`. |
| `ACCOUNTDISPLAYVALUE` | String | Yes | Pipe-separated financial dimension string or Customer/Vendor Account Number. |
| `TEXT` | String | No | Transaction line description / narrative text. |
| `DEBITAMOUNT` | Number | Yes | Line debit amount (0 if credit). |
| `CREDITAMOUNT` | Number | Yes | Line credit amount (0 if debit). |
| `CURRENCYCODE` | String | Yes | Currency ISO code (`EGP`, `USD`, `EUR`). |
| `INVOICE` | String | Conditional | Vendor or Customer Invoice Number for invoice matching. |
| `DOCUMENT` | String | No | Reference shipping bill of lading (B/L) or trip manifest document number. |
| `SALESTAXGROUP` | String | No | D365FO Sales Tax Group code (e.g., `VAT_14`). |
| `ITEMSALESTAXGROUP` | String | No | Item Tax Group code determining line item VAT logic. |
| `ITEMWITHHOLDINGTAXGROUPCODE` | String | No | Withholding tax code (e.g. `WHT_1%`). |

---

## 7. Data Batch Lifecycle Status Codes (`DataBatchStatus`)

| Status Enum Value | State Description | Next Allowed Transition |
| :--- | :--- | :--- |
| `Pending` | Batch parsed from Excel and saved in MongoDB, awaiting queue submission. | `Processing`, `Canceled` |
| `Processing` | Picked up by BullMQ worker; currently posting OData requests to D365FO. | `Completed`, `Failed` |
| `Completed` | Successfully posted to D365FO; voucher numbers generated in D365FO. | Final State |
| `Failed` | OData posting failed after retries; error details recorded in batch log. | `Pending` (Re-try) |
| `Canceled` | Batch manually canceled by finance admin. | Final State |

---

## 8. Essential Environment Variable Names

| Environment Variable Name | Required Scope | Purpose |
| :--- | :--- | :--- |
| `PORT` | Application | HTTP server listening port (default `3000`). |
| `MONGODB_URI` | Database | MongoDB connection string for storing batches, users, and cache fallback. |
| `REDIS_HOST`, `REDIS_PORT` | Queue & Cache | Redis connection parameters for BullMQ queues and L2 cache. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Authentication | Cryptographic secret keys for signing JWT tokens. |
| `D365FO_TENANT_ID` | D365FO Auth | Azure Active Directory Tenant ID for OAuth2 token generation. |
| `D365FO_CLIENT_ID` | D365FO Auth | App Registration Client ID with D365FO OData permissions. |
| `D365FO_CLIENT_SECRET` | D365FO Auth | App Registration Client Secret key. |
| `D365FO_RESOURCE` | D365FO Auth | Target D365FO environment URL (e.g. `https://mesco-prod.operations.dynamics.com`). |
| `D365FO_AUTHORITY` | D365FO Auth | Azure AD OAuth endpoint (`https://login.microsoftonline.com`). |
| `MAX_LINES_PER_BATCH` | Batch Rules | Batch size limit before splitting (enforced default: `1000`). |
