# Field-level data dictionary

The complete field-level dictionary is available as [03-data-dictionary.csv](03-data-dictionary.csv), with one row per schema-declared field plus implicit `_id` and configured timestamp fields.

Declared Mongoose indexes, including compound unique indexes and TTL settings, are recorded in [schema-indexes.csv](schema-indexes.csv). The dictionary also includes Mongoose's default `__v` version key where the schema does not disable it. For the 27 D365FO OData entity sets directly used by backend code, see the separate [OData field dictionary](d365fo-odata-data-dictionary.csv) (1,432 properties) and [OData entity-set catalog](d365fo-odata-entity-catalog.csv).

Custom D365FO table fields are listed separately in [d365fo-extension-data-dictionary.csv](d365fo-extension-data-dictionary.csv) (29 declared fields); entity keys/indexes are described in [d365fo-extension-entity-catalog.csv](d365fo-extension-entity-catalog.csv) and [d365fo-extension-indexes.csv](d365fo-extension-indexes.csv). Where the AxTable metadata omits nullability or key declarations, the CSV records that gap rather than infer it. D365FO platform-managed fields not present in the checked-in AxTable field list are not fabricated.

The CSV includes the requested entity, stored field name, label (blank where no label exists in schema code), Mongoose storage type, required/nullability declaration, primary key, FK/ref status, target, default, declared uniqueness, choice values, and source schema path. “Not required” is not interpreted as proof that MongoDB stores explicit nulls; it means the schema does not require a value. Typed fields inside `dfoJournalMappings` are listed as dotted array paths. Arbitrary object payloads such as source `data` remain dynamic and cannot be enumerated as fixed schema fields.

Mongoose type declarations are not a substitute for inspecting BSON documents or live database validators. See [schema gaps](09-schema-gaps.md) for runtime verification limits.
