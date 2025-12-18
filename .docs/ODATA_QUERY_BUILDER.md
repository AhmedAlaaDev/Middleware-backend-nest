# OData Query Builder Service

This service provides a type-safe and maintainable way to build OData queries for Dynamics 365 Finance and Operations.

## Features

- **Type-safe query building** - No more string concatenation errors
- **D365FO-specific support** - Built-in support for `cross-company` parameter
- **Full OData support** - Supports $filter, $select, $orderby, $top, $skip, $expand, $count, $search
- **Helper methods** - Convenient methods for common filter operations
- **URL encoding** - Automatic encoding of special characters

## Basic Usage

### Simple Query

```typescript
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

constructor(private readonly queryBuilder: ODataQueryBuilderService) {}

// Build a simple query
const query = this.queryBuilder.buildQuery('/data/Customers', {
  crossCompany: true,
  top: 100,
  skip: 0,
});
// Result: /data/Customers?cross-company=true&$top=100&$skip=0
```

### Query with Filter

```typescript
const filter = this.queryBuilder.eq('dataAreaId', 'mopp');

const query = this.queryBuilder.buildQuery('/data/Customers', {
  filter,
  crossCompany: true,
});
// Result: /data/Customers?cross-company=true&$filter=dataAreaId eq 'mopp'
```

### Complex Filters

```typescript
// Multiple conditions with 'and'
const filter = this.queryBuilder.and(
  this.queryBuilder.eq('dataAreaId', 'mopp'),
  this.queryBuilder.eq('BillingClassification', 'FREIGHT'),
  this.queryBuilder.gt('Amount', 1000),
);

// Multiple conditions with 'or'
const filter = this.queryBuilder.or(
  this.queryBuilder.eq('Status', 'Active'),
  this.queryBuilder.eq('Status', 'Pending'),
);

// Combined and/or
const filter = this.queryBuilder.and(
  this.queryBuilder.eq('dataAreaId', 'mopp'),
  this.queryBuilder.or(
    this.queryBuilder.eq('Type', 'A'),
    this.queryBuilder.eq('Type', 'B'),
  ),
);
```

## Filter Helper Methods

### Comparison Operators

```typescript
// Equal
this.queryBuilder.eq('fieldName', 'value')
// Result: fieldName eq 'value'

// Not equal
this.queryBuilder.ne('fieldName', 'value')
// Result: fieldName ne 'value'

// Greater than
this.queryBuilder.gt('fieldName', 100)
// Result: fieldName gt 100

// Greater than or equal
this.queryBuilder.ge('fieldName', 100)
// Result: fieldName ge 100

// Less than
this.queryBuilder.lt('fieldName', 100)
// Result: fieldName lt 100

// Less than or equal
this.queryBuilder.le('fieldName', 100)
// Result: fieldName le 100
```

### String Operators

```typescript
// Contains
this.queryBuilder.contains('fieldName', 'search')
// Result: contains(fieldName, 'search')

// Starts with
this.queryBuilder.startsWith('fieldName', 'prefix')
// Result: startswith(fieldName, 'prefix')

// Ends with
this.queryBuilder.endsWith('fieldName', 'suffix')
// Result: endswith(fieldName, 'suffix')
```

### Logical Operators

```typescript
// AND
this.queryBuilder.and('condition1', 'condition2', 'condition3')
// Result: condition1 and condition2 and condition3

// OR
this.queryBuilder.or('condition1', 'condition2')
// Result: condition1 or condition2

// NOT
this.queryBuilder.not('condition')
// Result: not (condition)
```

### In Operator

```typescript
// Value in list
this.queryBuilder.in('fieldName', ['value1', 'value2', 'value3'])
// Result: fieldName in ('value1', 'value2', 'value3')
```

## Query Options

### Select Specific Fields

```typescript
const query = this.queryBuilder.buildQuery('/data/Customers', {
  select: ['CustomerAccount', 'CustomerName', 'Email'],
  crossCompany: true,
});
// Result: /data/Customers?cross-company=true&$select=CustomerAccount,CustomerName,Email
```

### Order By

```typescript
// Single field
const query = this.queryBuilder.buildQuery('/data/Customers', {
  orderBy: 'CustomerName',
  crossCompany: true,
});

// Multiple fields
const query = this.queryBuilder.buildQuery('/data/Customers', {
  orderBy: ['CustomerName', 'CustomerAccount desc'],
  crossCompany: true,
});
```

### Pagination

```typescript
const query = this.queryBuilder.buildQuery('/data/Customers', {
  top: 50,
  skip: 100,
  crossCompany: true,
});
// Result: /data/Customers?cross-company=true&$top=50&$skip=100
```

### Expand Related Entities

```typescript
const query = this.queryBuilder.buildQuery('/data/FreeTextInvoiceHeaders', {
  expand: 'FreeTextInvoiceLines',
  crossCompany: true,
});
// Result: /data/FreeTextInvoiceHeaders?cross-company=true&$expand=FreeTextInvoiceLines
```

### Count

```typescript
const query = this.queryBuilder.buildQuery('/data/Customers', {
  count: true,
  crossCompany: true,
});
// Result: /data/Customers?cross-company=true&$count=true
```

## Real-World Examples

### Example 1: Get Billing Codes

```typescript
const filter = this.queryBuilder.and(
  this.queryBuilder.eq('dataAreaId', company),
  this.queryBuilder.eq('BillingClassification', billingClassId),
);

const query = this.queryBuilder.buildQuery('/data/BillingClassificationCodes', {
  filter,
  top: 100,
  skip: 0,
  crossCompany: true,
});
```

### Example 2: Get Customers with Filters

```typescript
const filters: string[] = [
  this.queryBuilder.eq('dataAreaId', company),
];

if (customerType) {
  filters.push(this.queryBuilder.eq('CustomerType', customerType));
}

if (status) {
  filters.push(this.queryBuilder.eq('Status', status));
}

if (searchTerm) {
  filters.push(this.queryBuilder.contains('CustomerName', searchTerm));
}

const filter = this.queryBuilder.and(...filters);

const query = this.queryBuilder.buildQuery('/data/Customers', {
  filter,
  select: ['CustomerAccount', 'CustomerName', 'Email', 'Phone'],
  orderBy: 'CustomerName',
  top: 50,
  skip: 0,
  crossCompany: true,
});
```

### Example 3: Date Range Filter

```typescript
const filters: string[] = [
  this.queryBuilder.eq('dataAreaId', company),
];

if (fromDate) {
  filters.push(this.queryBuilder.ge('InvoiceDate', fromDate.toISOString()));
}

if (toDate) {
  filters.push(this.queryBuilder.le('InvoiceDate', toDate.toISOString()));
}

const filter = this.queryBuilder.and(...filters);

const query = this.queryBuilder.buildQuery('/data/FreeTextInvoiceHeaders', {
  filter,
  orderBy: 'InvoiceDate desc',
  top: 100,
  crossCompany: true,
});
```

### Example 4: Complex OR Condition

```typescript
// Get dimension values for company OR global (empty LegalEntityId)
const filter = this.queryBuilder.or(
  this.queryBuilder.and(
    this.queryBuilder.eq('LegalEntityId', company),
    this.queryBuilder.eq('FinancialDimension', dimension),
  ),
  this.queryBuilder.and(
    this.queryBuilder.eq('LegalEntityId', ''),
    this.queryBuilder.eq('FinancialDimension', dimension),
  ),
);

const query = this.queryBuilder.buildQuery('/data/FinancialDimensionValues', {
  filter,
  crossCompany: true,
});
```

## Integration with Services

All D365FO services now use the query builder:

```typescript
// BillingService
const billingCodes = await billingService.getBillingCodeList(company, classId, {
  skipCount: 0,
  maxCount: 100,
  select: ['BillingCode', 'Description'],
  orderBy: 'BillingCode',
});

// DimensionService
const dimensions = await dimensionService.getDimensionList({
  select: ['DimensionName', 'DimensionValue'],
  orderBy: 'DimensionName',
});

// CustomerInvoiceService
const invoices = await customerInvoiceService.getInvoiceHeaders(company, {
  filters: [
    queryBuilder.ge('InvoiceDate', '2024-01-01'),
    queryBuilder.eq('Status', 'Posted'),
  ],
  select: ['InvoiceNumber', 'InvoiceDate', 'Amount'],
  orderBy: 'InvoiceDate desc',
});
```

## Benefits

1. **Type Safety** - Compile-time checking of query structure
2. **Maintainability** - Centralized query building logic
3. **Readability** - Clear, expressive query construction
4. **Reusability** - Build complex queries from simple parts
5. **URL Safety** - Automatic encoding of special characters
6. **D365FO Support** - Built-in support for cross-company queries

