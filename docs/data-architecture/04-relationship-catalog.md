# Relationship catalog

## Evidence levels

- **Declared implementation reference**: a Mongoose `ref` or ref array. This is an application-level reference; MongoDB does not enforce target existence.
- **Application correlation**: service or repository logic uses a string key to find associated documents. This is a logical association only.
- **Physical database foreign key**: none is declared in the inspected Mongoose schemas.

| ID | Source field → target key | Direction | Cardinality | Required / nullable | Ownership enforced | Junction | Reverse navigation | Evidence tier | Delete behavior / disambiguation |
|---|---|---|---|---|---|---|---|---|---|
| R001 | RefreshToken.userId → User._id | Child to parent | N:1 | Required / non-null by Mongoose | No | None | Mongoose `ref`; populate use not verified | 2 | No database cascade declared |
| R002 | AccessDecision.userId → User._id | Audit row to subject user | N:1 | Required / non-null by Mongoose | No | None | Mongoose `ref`; populate use not verified | 2 | No cascade declared |
| R003 | AccessDecision.actorUserId → User._id | Audit row to actor user | N:1 | Required / non-null by Mongoose | No | None | Mongoose `ref`; populate use not verified | 2 | No cascade declared |
| A001 | DataSourceRecord.batchId → DataBatch._id | Child to batch by service query | N:1 inferred | Not required in schema | No | None | Filter by batchId; not a navigation property | 3 | Batch cleanup by batchId |
| A002 | DataEnhancedRecord.batchId → DataBatch._id | Child to batch by service query | N:1 inferred | Not required in schema | No | None | Filter by batchId; not a navigation property | 3 | Batch cleanup by batchId |
| A003 | DataBatchError.batchId → DataBatch._id | Child to batch by service query | N:1 inferred | Not required in schema | No | None | Filter by batchId; not a navigation property | 3 | Batch cleanup by batchId |
| A004 | DataBatchMissingMasterData.batchId → DataBatch._id | Child to batch by service query | N:1 inferred | Required string; nullability of stored null not runtime checked | No | None | Filter by batchId; not a navigation property | 3 | Batch cleanup by batchId |
| A005 | QueueJobGroup.jobId → QueueJob.jobId | Group to job by queue store | N:1 inferred | Required string | No | None; compound unique `(jobId,index)` is ordering uniqueness, not a junction | Filter by jobId | 3 | Queue store removes groups by jobId |
| A006 | QueueJob.batchId → DataBatch._id | Job to batch by lifecycle lookup | N:1 inferred | Required string | No | None | Filter by batchId; not a navigation property | 3 | No database cascade declared |
| A007 | User.refreshTokens[] → RefreshToken._id | Parent array to child refs | 1:N application reference | Array not required | No | None | Mongoose ref array; populate use not verified | 2 | `findOneAndDelete` hook deletes tokens; hook is application-side and query-method-specific |

Every listed edge has its full source path, evidence type, confidence, and notes in [relationship-evidence.csv](relationship-evidence.csv). No row is Tier 1 authoritative database FK metadata.

All relationship lines are in the logical ERD and have matching rows in the evidence CSV. The physical collection diagram has no relationship lines because no MongoDB foreign key constraints are declared. Indexes can enforce uniqueness of a value or tuple; they do not prove a reference.

No N:M relation or junction collection is proven. Company/account numbers, billing codes/classifications, currency codes, and dimension keys are business identifiers or replicated attributes, not database FKs.

## D365FO OData metadata relationships

The local EDMX/CSDL snapshot declares **189 navigation properties** across the 27 entity sets directly referenced by backend service code. These are represented in [d365fo-odata-relationships.csv](d365fo-odata-relationships.csv) and the [D365FO navigation graph](diagrams/d365fo-integration-relationships.mmd). They carry evidence IDs `D0001`–`D0189` and Tier 1 metadata evidence rows in `relationship-evidence.csv`. The reported cardinality is the property shape (`Collection(...)` or single-valued navigation); reverse multiplicity and the underlying SQL constraint are not inferred. A CSDL referential constraint, when present, is recorded as a property mapping, not proof of runtime referential integrity.

The four regular custom AxTable definitions in `SDDDFO` declare **zero table relations**. `CustomIntegrationParameters.ProviderName` is an alternate-key index; that uniqueness is recorded in the extension index CSV. No AxTable relation edges are drawn for the four custom tables.
