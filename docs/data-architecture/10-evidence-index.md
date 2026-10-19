# Evidence index and validation status

| Evidence | Location | Supports |
|---|---|---|
| Main Mongo connection and model registration | `src/modules/db/db.module.ts` | Application store setup and platform schemas |
| Model schema declarations | `src/modules/**/schemas/*.schema.ts` | Collection names, fields, defaults, required/index/ref declarations |
| Model registration | `src/modules/**` module files | Models wired into the Nest application |
| Batch persistence and cleanup | `src/modules/data-batch/services/data-batch.service.ts`, repositories | Batch lifecycle and child cleanup by batchId |
| Queue persistence | `src/modules/queue/services/queue-job-store.service.ts` | Job/group correlation and cleanup |
| Identity references | `src/modules/auth/schemas/refresh-token.schema.ts`, `src/modules/user/schemas/user.schema.ts`, `access-decision.schema.ts` | Explicit Mongoose refs and user deletion hook |
| D365FO integration | `src/modules/d365fo/services/**`, Postman collection | OData access patterns, not a complete server schema |
| D365FO CSDL snapshot | [`meta.xml`](../../meta.xml) | 4,166 OData entity types/sets; used-set catalog, fields, and navigation metadata are extracted to the accompanying CSVs |
| D365FO custom table metadata | `../../SDDDFO/MetaData/**/AxTable/*.xml` | Four regular custom tables, 29 declared fields, one alternate-key index, and no declared AxTable relations |
| D365FO custom enum metadata | `../../SDDDFO/MetaData/MBDRIntegrationBase/MBDRIntegrationbase/AxEnum/IntegrationLogTypeEnum.xml` | Choice values for the custom integration log type |
| D365FO customization behavior | `../../SDDDFO/MetaData/**/AxClass/*.xml` | Integration-log inserts, feature reads/writes, parameter lookup, and user-scoped bank reconciliation summary rebuilds |
| Workbook reconciliation app | `../../bank mapping/backend/src/**` | File upload/matching workflow; no persistence schemas/configuration discovered |
| Data source configuration | `src/config/db.config.ts`, `observability.config.ts`, `redis.config.ts`, `.env.example` | Source classes and configured access methods; no secret values copied |
| Edge evidence | `relationship-evidence.csv` | Evidence row for every relationship edge in ERD diagrams |

## Validation status

Entity discovery scans Mongoose schema decorators and excludes DTO-only models. Direct OData entity-set references in backend TypeScript were matched to the `meta.xml` snapshot; all 27 were present. D365FO extension AxTable metadata was scanned: 4 regular tables and 9 TempDB definitions; the regular tables declare 29 fields, one alternate-key index, and no table relations. Relationship edge IDs were cross-checked against the evidence CSV. README targets, entity/field counts, and ERD structure were checked statically. No Mermaid CLI or renderer was available/used, so diagrams were not independently rendered. No live database/OData request or record-integrity check was run.
