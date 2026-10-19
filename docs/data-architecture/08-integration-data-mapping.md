# Integration data mapping and lineage

The lineage diagram is a data-flow view, not an ERD. Arrows represent application traffic and persistence boundaries, never physical foreign keys.

- Excel workbooks enter through HTTP upload handlers, are parsed by the Excel module, then persisted as source/enhanced batch records in MongoDB. Durable object/file storage was not identified.
- The frontend calls the NestJS API; it is not a direct database client. See `D365FOMiddleware_Client` API services for frontend contracts.
- The backend reads finance master data through D365FO OData and writes journals/invoices through domain services and queue workers. Finance transaction records remain in D365FO.
- The code-used OData set names are checked against `meta.xml`. The metadata catalog contains the declared OData keys for 27 consumed sets and the data dictionary records all 1,432 properties in those set types. This is API-contract evidence, not proof of underlying finance SQL table names.
- `SDDDFO` provides X++ table and service metadata for custom integration parameters/logs, feature flags, and bank reconciliation summary records; see the extension table catalog and source paths for field evidence.
- The separate `bank mapping` app processes uploaded bank/IST workbooks in memory and returns the reconciled workbook. No local database, object store, or persisted association was found.
- OData navigation properties from those consumed sets are cataloged separately (189 total). They are external entity associations; they are not drawn as local MongoDB FKs.
- Redis supports BullMQ, cache tiers, and log streaming. MongoDB stores durable queue metadata and may store archived logs. Redis is not relational.
- Matching account numbers, invoice numbers, or OData payload values do not establish physical relationships.

Diagrams: [cross-system-data-lineage.mmd](diagrams/cross-system-data-lineage.mmd) and [D365FO OData navigation graph](diagrams/d365fo-integration-relationships.mmd).
