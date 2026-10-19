# Data architecture reference

This reference describes code-declared MongoDB models and the D365FO OData contracts in the repository's static EDMX/CSDL snapshot. It does **not** claim that runtime MongoDB contents or the currently connected D365FO environment match those sources; neither live system was queried.

## Start here

1. [Data source inventory](01-data-source-inventory.md)
2. [Complete entity catalog](02-complete-entity-catalog.md)
3. [Field-level data dictionary](03-data-dictionary.md) ([field CSV](03-data-dictionary.csv), [index CSV](schema-indexes.csv))
4. [Relationship catalog](04-relationship-catalog.md) and [relationship evidence CSV](relationship-evidence.csv)
5. [Unverified relationships](unverified-relationships.md)
6. [Integrity assessment](07-data-integrity-assessment.md)
7. [Integration mapping](08-integration-data-mapping.md)
8. [Schema gaps](09-schema-gaps.md)
9. [Evidence index and validation](10-evidence-index.md)
10. [D365FO OData entity-set catalog](d365fo-odata-entity-catalog.csv), [field dictionary](d365fo-odata-data-dictionary.csv), and [navigation properties](d365fo-odata-relationships.csv)
11. [D365FO extension tables](d365fo-extension-entity-catalog.csv), [fields](d365fo-extension-data-dictionary.csv), and [indexes](d365fo-extension-indexes.csv)

## Diagrams

- [Enterprise data landscape](diagrams/enterprise-data-landscape.mmd)
- [Complete logical ERD](diagrams/complete-logical-erd.mmd)
- [Verified physical collection model](diagrams/verified-physical-erd.mmd)
- [Logical/application associations](diagrams/logical-associations.mmd)
- [Batch processing domain](diagrams/data-batch-domain.mmd)
- [Master data domain](diagrams/master-data-domain.mmd)
- [Queue domain](diagrams/queue-domain.mmd)
- [Identity and access domain](diagrams/security-domain.mmd)
- [Platform support domain](diagrams/platform-support-domain.mmd)
- [Invoice posting domain](diagrams/invoice-domain.mmd)
- [Vendor processing domain](diagrams/vendor-domain.mmd)
- [Cash processing domain](diagrams/cash-domain.mmd)
- [Ledger processing domain](diagrams/ledger-domain.mmd)
- [Accounts-receivable processing domain](diagrams/accounts-receivable-domain.mmd)
- [Closing processing domain](diagrams/closing-domain.mmd)
- [Reconciliation module data view](diagrams/reconciliation-domain.mmd)
- [Cross-system data lineage](diagrams/cross-system-data-lineage.mmd)
- [D365FO OData navigation graph](diagrams/d365fo-integration-relationships.mmd)
- [D365FO custom extension tables](diagrams/d365fo-extension-tables.mmd)

## Completion snapshot

- Declared middleware MongoDB models: **29**. The EDMX/CSDL snapshot contains 4,166 external entity types/sets; backend code references **27** distinct OData entity sets.
- Checked-in D365FO X++ metadata adds **4 regular custom tables**; the separate bank-reconciliation workbook app has no persisted schema. Total code-declared persisted table models across middleware and checked-in D365FO extensions: **33**.
- Database-enforced foreign keys declared in repository: **0**.
- Explicit Mongoose reference paths represented: **4** (three child-to-User refs and one User ref array); these do not enforce referential integrity. The app-used OData metadata declares **189** navigation properties.
- Application correlations represented separately: **6**.
- Coverage: **29/29 (100%)** of code-declared MongoDB models appear in the complete ERDs; **4/4 (100%)** checked-in regular D365FO extension tables appear in their extension model; **27/27 (100%)** OData sets referenced by backend code are cataloged against the local EDMX snapshot. These percentages do not measure live-environment coverage.
- Scope: D365FOMiddleware backend/frontend, adjacent `SDDDFO` customizations, and the separate workbook reconciliation app. Live systems were not queried.
