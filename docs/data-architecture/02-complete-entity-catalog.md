# Complete entity catalog

Scope: Mongoose schemas explicitly declared under `src/modules/**/schemas/*.schema.ts`. **29 persisted models** were found. MongoDB collections may also exist at runtime without a schema in this repository; live collections were not queried.

| Entity ID | Model | Collection | Data source | Primary key | Module | Evidence |
|---|---|---|---|---|---|---|
| E001 | `AccountCustomerInvoiceMapping` | `account_customer_invoice_mappings` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/account-customer-invoice-mapping.schema.ts](../../src/modules/master-data/schemas/account-customer-invoice-mapping.schema.ts) |
| E002 | `AppSetting` | `app_settings` | MongoDB | `_id` (ObjectId) | Platform configuration | [src/modules/db/schemas/app-setting.schema.ts](../../src/modules/db/schemas/app-setting.schema.ts) |
| E003 | `ApplicationLog` | `application_logs` | MongoDB | `_id` (ObjectId) | Observability | [src/modules/observability/schemas/application-log.schema.ts](../../src/modules/observability/schemas/application-log.schema.ts) |
| E004 | `BillingClassification` | `billing_classifications` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/billing-classification.schema.ts](../../src/modules/master-data/schemas/billing-classification.schema.ts) |
| E005 | `BillingCodeVersion` | `billing_code_versions` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/billing-code-version.schema.ts](../../src/modules/master-data/schemas/billing-code-version.schema.ts) |
| E006 | `BillingCode` | `billing_codes` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/billing-code.schema.ts](../../src/modules/master-data/schemas/billing-code.schema.ts) |
| E007 | `CacheEntry` | `cache_entries` | MongoDB | `_id` (ObjectId) | Caching | [src/modules/resilience/schemas/cache-entry.schema.ts](../../src/modules/resilience/schemas/cache-entry.schema.ts) |
| E008 | `Customer` | `customers` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/customer.schema.ts](../../src/modules/master-data/schemas/customer.schema.ts) |
| E009 | `DataBatchError` | `data_batch_errors` | MongoDB | `_id` (ObjectId) | Batch processing | [src/modules/data-batch/schemas/data-batch-error.schema.ts](../../src/modules/data-batch/schemas/data-batch-error.schema.ts) |
| E010 | `DataBatchMissingMasterData` | `data_batch_missing_master_data` | MongoDB | `_id` (ObjectId) | Batch processing | [src/modules/data-batch/schemas/data-batch-missing-master-data.schema.ts](../../src/modules/data-batch/schemas/data-batch-missing-master-data.schema.ts) |
| E011 | `DataBatch` | `data_batches` | MongoDB | `_id` (ObjectId) | Batch processing | [src/modules/data-batch/schemas/data-batch.schema.ts](../../src/modules/data-batch/schemas/data-batch.schema.ts) |
| E012 | `DataEnhancedRecord` | `data_enhanced_records` | MongoDB | `_id` (ObjectId) | Batch processing | [src/modules/data-batch/schemas/data-enhanced-record.schema.ts](../../src/modules/data-batch/schemas/data-enhanced-record.schema.ts) |
| E013 | `DataSourceRecord` | `data_source_records` | MongoDB | `_id` (ObjectId) | Batch processing | [src/modules/data-batch/schemas/data-source-record.schema.ts](../../src/modules/data-batch/schemas/data-source-record.schema.ts) |
| E014 | `ExchangeRate` | `exchange_rates` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/exchange-rate.schema.ts](../../src/modules/master-data/schemas/exchange-rate.schema.ts) |
| E015 | `FinancialDimensionValue` | `financial_dimension_values` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/financial-dimension-value.schema.ts](../../src/modules/master-data/schemas/financial-dimension-value.schema.ts) |
| E016 | `FinancialDimension` | `financial_dimensions` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/financial-dimension.schema.ts](../../src/modules/master-data/schemas/financial-dimension.schema.ts) |
| E017 | `LedgerEntryBatchCounter` | `ledger_entry_batch_counters` | MongoDB | `_id` (ObjectId) | Platform configuration | [src/modules/db/schemas/ledger-entry-batch-counter.schema.ts](../../src/modules/db/schemas/ledger-entry-batch-counter.schema.ts) |
| E018 | `LedgerVoucherCounter` | `ledger_voucher_counters` | MongoDB | `_id` (ObjectId) | Platform configuration | [src/modules/db/schemas/ledger-voucher-counter.schema.ts](../../src/modules/db/schemas/ledger-voucher-counter.schema.ts) |
| E019 | `Ledger` | `ledgers` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/ledger.schema.ts](../../src/modules/master-data/schemas/ledger.schema.ts) |
| E020 | `MainAccount` | `main_accounts` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/main-account.schema.ts](../../src/modules/master-data/schemas/main-account.schema.ts) |
| E021 | `PaymentTerm` | `payment-terms` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/payment-term.schema.ts](../../src/modules/master-data/schemas/payment-term.schema.ts) |
| E022 | `QueueJobGroup` | `queue_job_groups` | MongoDB | `_id` (ObjectId) | Queue processing | [src/modules/queue/schemas/queue-job-group.schema.ts](../../src/modules/queue/schemas/queue-job-group.schema.ts) |
| E023 | `QueueJob` | `queue_jobs` | MongoDB | `_id` (ObjectId) | Queue processing | [src/modules/queue/schemas/queue-job.schema.ts](../../src/modules/queue/schemas/queue-job.schema.ts) |
| E024 | `RefreshToken` | `refresh_tokens` | MongoDB | `_id` (ObjectId) | Identity and access | [src/modules/auth/schemas/refresh-token.schema.ts](../../src/modules/auth/schemas/refresh-token.schema.ts) |
| E025 | `SyncJob` | `sync_jobs` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/sync-job.schema.ts](../../src/modules/master-data/schemas/sync-job.schema.ts) |
| E026 | `TaxItemGroupHeading` | `tax_item_group_headings` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/tax-item-group-heading.schema.ts](../../src/modules/master-data/schemas/tax-item-group-heading.schema.ts) |
| E027 | `AccessDecision` | `user_access_decisions` | MongoDB | `_id` (ObjectId) | Identity and access | [src/modules/user/schemas/access-decision.schema.ts](../../src/modules/user/schemas/access-decision.schema.ts) |
| E028 | `User` | `users` | MongoDB | `_id` (ObjectId) | Identity and access | [src/modules/user/schemas/user.schema.ts](../../src/modules/user/schemas/user.schema.ts) |
| E029 | `Vendor` | `vendors` | MongoDB | `_id` (ObjectId) | Master data | [src/modules/master-data/schemas/vendor.schema.ts](../../src/modules/master-data/schemas/vendor.schema.ts) |

DTOs, API contracts, processor models and OData interfaces are excluded unless registered as Mongoose schemas. No SQL ORM schema or migration set was found.

## External D365FO data entities used by application code

The repository also contains an EDMX/CSDL snapshot with **4,166 entity types and entity sets**. Source scanning found **27 distinct OData entity sets** used by backend service code. Those external data entities are not local MongoDB collections and are cataloged separately in [d365fo-odata-entity-catalog.csv](d365fo-odata-entity-catalog.csv); their discovered fields are in [d365fo-odata-data-dictionary.csv](d365fo-odata-data-dictionary.csv). The catalog identifies the metadata-declared OData key, not necessarily the underlying finance SQL table key.

The adjacent `SDDDFO` X++ source contains **4 regular D365FO table definitions** (29 declared fields and one alternate-key index) plus 9 TempDB table definitions. The regular tables are cataloged in [d365fo-extension-entity-catalog.csv](d365fo-extension-entity-catalog.csv); fields and indexes are in [d365fo-extension-data-dictionary.csv](d365fo-extension-data-dictionary.csv) and [d365fo-extension-indexes.csv](d365fo-extension-indexes.csv). The X++ metadata declares no table relations for those four tables. The separate bank-reconciliation workbook app contains no persisted entity schema; its uploads and outputs are transient.
