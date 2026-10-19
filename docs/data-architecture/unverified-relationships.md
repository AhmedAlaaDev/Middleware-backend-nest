# Unverified relationships and metadata needed

| Candidate association | Evidence seen | Why unverified | Metadata needed to confirm |
|---|---|---|---|
| DataBatch → DataSourceRecord / DataEnhancedRecord / DataBatchError / DataBatchMissingMasterData | `batchId` strings and service filters/cleanup | No Mongoose ref or database FK | Runtime Mongo validators/indexes and an explicit persistence integrity policy |
| QueueJob → QueueJobGroup | `jobId` query and unique `(jobId,index)` index | Parent job existence is not constrained | Runtime validator/index inventory or an explicit schema ref and integrity check |
| QueueJob → DataBatch | `batchId` correlation | No target ref or FK | Queue lifecycle mapping and runtime record validation |
| DataBatch.billingCodeId → BillingCode | Identifier naming only | No target or mapping proven | Creation/update code mapping and deployed example/schema metadata |
| BillingCode → BillingClassification / BillingCodeVersion | Related business fields used in processing | String-key lookup, not a declared ref | Exact join code, uniqueness rules, and D365FO metadata; still only an application association absent a DB constraint |
| Customer/Vendor values → currency, terms, groups | Synchronized business identifiers | Most target entities are not represented locally | D365FO entity metadata and explicit master-data mapping rules |

Explicit refs R001–R003 are confirmed as Mongoose implementation refs, not database-enforced foreign keys. Target record existence, navigation population, and delete behavior beyond the User query hook were not verified.
