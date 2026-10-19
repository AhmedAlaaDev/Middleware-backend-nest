# Cross-module data usage

CRUD cells below reflect persistence calls in backend services and repositories. A route or UI action alone was not treated as proof of persistence.

| Entity | Creating modules | Reading modules | Updating modules | Deleting modules |
|---|---|---|---|---|
| `account_customer_invoice_mappings` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `app_settings` | Settings seed | Settings / DB service | Settings seed/service | — |
| `application_logs` | Observability archive | Observability query | Observability archive (upsert) | Observability pruning / TTL |
| `billing_classifications` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `billing_code_versions` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `billing_codes` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `cache_entries` | Resilience cache repository | Resilience cache repository | Resilience cache repository | Resilience cache repository / TTL |
| `customers` | Master-data sync / inline creation | Master-data queries / processors | Master-data sync / inline creation | Customer repository (company-scoped cleanup) |
| `data_batch_errors` | DataBatchService | DataBatch queries / export | — | DeleteBatchHandler / reprocess cleanup |
| `data_batch_missing_master_data` | DataBatchService | DataBatch queries / remediation | DataBatchService / remediation | DeleteBatchHandler |
| `data_batches` | DataBatchService | DataBatch queries / guards / queue | DataBatchService / handlers | DeleteBatchHandler |
| `data_enhanced_records` | DataBatchService | DataBatch queries / export | — | DeleteBatchHandler / reprocess cleanup |
| `data_source_records` | DataBatchService | DataBatch queries / export | — | DeleteBatchHandler / reprocess cleanup |
| `exchange_rates` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `financial_dimension_values` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `financial_dimensions` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `ledger_entry_batch_counters` | DB/counter service | DB/counter service | DB/counter service | — |
| `ledger_voucher_counters` | DB/counter service | DB/counter service | DB/counter service | — |
| `ledgers` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `main_accounts` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `payment-terms` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `queue_job_groups` | QueueJobStoreService | Queue admin / recovery | QueueJobStoreService | Queue cleanup service |
| `queue_jobs` | QueueJobStoreService | Queue admin / recovery | QueueJobStoreService | Queue cleanup service |
| `refresh_tokens` | SessionService | Auth/session services | SessionService | SessionService / User deletion hook |
| `sync_jobs` | SyncJob repository | Master-data queries / status | SyncJob repository | TTL index |
| `tax_item_group_headings` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | — |
| `user_access_decisions` | AccessReviewService | Access review service | — | — |
| `users` | User/Auth services | User/Auth/access review | User/Auth services | No service delete path found; schema hook is conditional on query deletion |
| `vendors` | Master-data sync | Master-data queries / processors | Master-data sync (bulk upsert) | Vendor repository (company-scoped cleanup) |
| D365FO `CustomIntegrationParameters` | D365FO admin/configuration | `CustomIntegrationParameters.find` and integration X++ services | `find(..., _forUpdate=true)` supports update locking; no write statement located in the inspected source | — |
| D365FO `CustomIntegrationLog` | D365FO `CustomIntegrationLogService.saveLog` | D365FO integration log form | — | No retention/delete path found in inspected source |
| D365FO `MBDRCustomFeaturesManagement` | Feature seed/form | Feature manager and administration form | Form/event-handler paths | Form/event-handler paths |
| D365FO `BankAccountTransSummary` | Bank reconciliation form extension | Summary data source on bank reconciliation forms | Rebuilt from un-reconciled transactions on page activation | Deletes current user's rows before rebuild |

The per-entity module mapping is summarized by domain above; see the entity catalog for the full 29-collection list and schema source locations.

## Data ownership and lifecycle

- Batch processing owns `data_batches`, source/enhanced/error/missing-master-data records. Batch removal explicitly deletes correlated documents by string `batchId`; there is no schema-level cascade or FK.
- The master-data module refreshes MongoDB copies from D365FO; D365FO remains authoritative for synchronized finance master data. Some mappings are middleware-maintained.
- Authentication owns user accounts, refresh tokens, and access-decision audit rows. User deletion attempts token cleanup through a Mongoose `findOneAndDelete` hook. Access-decision deletion behavior is not declared.
- The queue module owns durable job/group metadata in MongoDB and transient execution in Redis.
- Observability owns log writes, queries, and pruning. Its Mongo connection can fall back to the main URI.
- Cache entries are transient and use TTL. Redis and Mongo cache layers are not business entities.
- OData transaction calls write to D365FO. They do not establish middleware database relationships.
- The D365FO customization rows above are external to the middleware MongoDB schema. Their lifecycle is based on the checked-in X++ source, not live finance audit history.
- The separate `bank mapping` app reads uploaded workbooks and returns generated files; no durable create/update/delete persistence was found.

No runtime CRUD history or records were queried.
