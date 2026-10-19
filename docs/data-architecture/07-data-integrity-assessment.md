# Data integrity assessment

## Confirmed schema facts

- Declared persisted entities are MongoDB documents with an implicit `_id` ObjectId unless explicitly declared. User and RefreshToken also explicitly default `_id` to ObjectId values.
- No SQL FKs, Mongo cross-collection validators, or schema migration scripts are declared in this repository.
- Mongoose refs exist from refresh tokens and access decisions to users. They are not database-enforced constraints.
- Batch and queue identifiers appear in code as ordinary strings used by services; those fields are not declared as refs.

## Risks and recommendations

| Finding | Classification | Evidence / impact |
|---|---|---|
| Batch children use string `batchId` and are cleaned by service code | Potential orphan risk | Cleanup can fail or be partial; no FK guarantee |
| Queue groups use string `jobId`; unique `(jobId,index)` only constrains positions | Potential orphan risk | Parent job existence is not constrained |
| User token refs duplicate a parent array and child pointer | Potential consistency risk | The array can become stale; population/maintenance was not verified |
| AccessDecision refs require ObjectId values but do not validate target existence | Potential orphan risk | Required only means a value is present |
| `DataBatch.billingCodeId` is an untyped string while BillingCode is keyed by business fields | Ambiguous association | No target or join semantics proven |
| MongoDB stores synchronized D365FO master data | Staleness risk | Refresh timing and runtime freshness were not checked |
| Schema indexes may differ from deployed indexes | Runtime constraint unknown | Deployed index state was not queried |
| Separate log URI can fall back to the main Mongo URI | Operational separation risk | Configuration permits shared physical storage |
| `CustomIntegrationParameters.ClientSecret` uses `Notes` EDT while `LastAccessToken` uses `EncryptedString` | Potential security risk | AxTable metadata does not mark the client-secret field with an encrypted EDT; actual deployed encryption/storage protections were not inspected |
| `CustomIntegrationLog` persists request and response payload fields with no declared retention/index policy | Potential data exposure and growth risk | X++ log service writes payloads in an independent transaction; no cleanup policy was found in the checked-in code |
| `BankAccountTransSummary` has no declared unique index or table relation and is rebuilt by deleting only the current user's rows | Potential stale/duplicate summary risk | Form extension deletes current-user rows and inserts a grouped snapshot; abandoned user rows may remain |

No actual orphan, duplicate, or stale records were queried; these conditions remain unknown, not confirmed defects. No production code, database record, schema, or deployment configuration was modified.
