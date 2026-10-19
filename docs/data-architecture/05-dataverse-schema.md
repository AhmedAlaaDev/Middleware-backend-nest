# Dataverse / Dynamics schema status

No Dataverse table logical names, Dataverse solution XML, `EntityDefinitions` or `RelationshipDefinitions` response, or Dataverse SDK binding was found in this backend repository. The inspected integration is to **Dynamics 365 Finance & Operations OData**, which is distinct from Dataverse.

Unlike Dataverse, the repository does contain an [EDMX/CSDL snapshot](../../meta.xml). It describes 4,166 OData entity types/entity sets and their properties/navigation metadata. For the 27 OData sets consumed by application code, this reference catalogs keys, 1,432 properties, and 189 navigation properties. The OData field dictionary preserves exact EDM types, declared nullability, key participation, choice values, and label IDs where available; label IDs are not resolved to user-facing text. This is a contract snapshot, not live environment metadata or a complete physical SQL schema export; it does not establish all backing tables, deployed constraints, cascade behavior, or current-environment parity.

No claims are made here about finance codes being primary GUIDs or OData payload properties being physical FKs. No live metadata endpoint or connected read-only environment was accessed.

The adjacent `SDDDFO` source contributes four regular custom D365FO AxTable definitions. Their declared fields, the `IntegrationLogTypeEnum` choices, and the one alternate-key index are cataloged separately; they contain no explicit table relation declarations in this source snapshot. `NoYes` enum values and platform-managed system columns are not included in this customization source.
