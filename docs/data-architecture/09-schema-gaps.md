# Schema gaps

1. No live MongoDB collection or index inventory was queried. The catalog covers code-declared Mongoose schemas, not ad hoc runtime collections.
2. A local D365FO EDMX/CSDL snapshot exists and was parsed for all OData sets directly referenced by code. It may not match the currently connected environment. Entity types not directly referenced by application code were not expanded into the field dictionary; 4,166 entity types/entity sets exist in the snapshot.
3. No Dataverse table/relationship metadata or solution XML is present. The integration found is Dynamics 365 Finance & Operations.
4. The adjacent `SDDDFO` repository contains static custom AxTable metadata for four regular tables and nine TempDB tables. This may not be the deployed layer/version; standard base-table metadata and runtime SQL constraints are not included in that source repository.
5. MongoDB does not declare relational FKs in these schemas; `ref` options do not enforce target existence.
6. No external object store or durable upload store configuration was discovered.
7. The field dictionary reflects TypeScript types and Mongoose decorators. For properties without `required: true`, acceptance of stored BSON null can depend on runtime schema/configuration; the dictionary avoids claiming nullable=true.
8. D365FO OData navigation metadata declares associations but does not prove physical SQL FK constraints or data integrity in the live finance database.
9. Deployed MongoDB indexes were not checked.
10. The backend checkout contains pre-existing uncommitted changes. This task adds documentation only and preserves those changes.
