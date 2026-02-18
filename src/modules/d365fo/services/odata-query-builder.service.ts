import { Injectable } from '@nestjs/common';

export interface ODataQueryOptions {
  select?: string[];
  filter?: string | string[];
  orderBy?: string | string[];
  top?: number;
  skip?: number;
  expand?: string | string[];
  crossCompany?: boolean;
  count?: boolean;
  search?: string;
}

/**
 * Service for building OData queries for Dynamics 365 Finance and Operations
 */
@Injectable()
export class ODataQueryBuilderService {
  /**
   * Build an OData query string from options
   */
  public buildQuery(endpoint: string, options?: ODataQueryOptions): string {
    if (!options || Object.keys(options).length === 0) {
      return endpoint;
    }

    const queryParams: string[] = [];

    // Cross-company support (D365FO specific)
    if (options.crossCompany !== false) {
      queryParams.push('cross-company=true');
    }

    // $select - specify which fields to return
    if (options.select && options.select.length > 0) {
      queryParams.push(`$select=${this.encodeValue(options.select.join(','))}`);
    }

    // $filter - filter results
    if (options.filter) {
      const filterValue = Array.isArray(options.filter)
        ? this.buildFilterExpression(options.filter)
        : options.filter;
      queryParams.push(`$filter=${this.encodeValue(filterValue)}`);
    }

    // $orderby - sort results
    if (options.orderBy) {
      const orderByValue = Array.isArray(options.orderBy)
        ? options.orderBy.join(',')
        : options.orderBy;
      queryParams.push(`$orderby=${this.encodeValue(orderByValue)}`);
    }

    // $top - limit number of results
    if (options.top !== undefined && options.top > 0) {
      queryParams.push(`$top=${options.top}`);
    }

    // $skip - skip number of results (pagination)
    if (options.skip !== undefined && options.skip > 0) {
      queryParams.push(`$skip=${options.skip}`);
    }

    // $expand - expand related entities
    if (options.expand) {
      const expandValue = Array.isArray(options.expand)
        ? options.expand.join(',')
        : options.expand;
      queryParams.push(`$expand=${this.encodeValue(expandValue)}`);
    }

    // $count - include count of results
    if (options.count) {
      queryParams.push('$count=true');
    }

    // $search - full-text search (if supported)
    if (options.search) {
      queryParams.push(`$search=${this.encodeValue(options.search)}`);
    }

    const queryString =
      queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    return `${endpoint}${queryString}`;
  }

  /**
   * Build a filter expression from an array of filter conditions
   * Combines them with 'and' operator
   */
  public buildFilterExpression(filters: string[]): string {
    if (filters.length === 0) return '';
    if (filters.length === 1) return filters[0];

    return filters.join(' and ');
  }

  /**
   * Helper method to create equality filter
   */
  public eq(field: string, value: string | number | boolean): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} eq ${formattedValue}`;
  }

  /**
   * Helper method to create not equal filter
   */
  public ne(field: string, value: string | number | boolean): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} ne ${formattedValue}`;
  }

  /**
   * Helper method to create greater than filter
   */
  public gt(field: string, value: string | number): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} gt ${formattedValue}`;
  }

  /**
   * Helper method to create greater than or equal filter
   */
  public ge(field: string, value: string | number): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} ge ${formattedValue}`;
  }

  /**
   * Helper method to create less than filter
   */
  public lt(field: string, value: string | number): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} lt ${formattedValue}`;
  }

  /**
   * Helper method to create less than or equal filter
   */
  public le(field: string, value: string | number): string {
    const formattedValue = typeof value === 'string' ? `'${value}'` : value;
    return `${field} le ${formattedValue}`;
  }

  /**
   * Greater than or equal for Edm.DateTimeOffset (OData datetime literal, no quotes).
   * Use for D365FO date/datetime fields to avoid 400 from quoted literals.
   */
  public geDateTime(field: string, isoDateTime: string): string {
    return `${field} ge ${isoDateTime}`;
  }

  /**
   * Less than for Edm.DateTimeOffset (OData datetime literal, no quotes).
   * Use for D365FO date/datetime fields to avoid 400 from quoted literals.
   */
  public ltDateTime(field: string, isoDateTime: string): string {
    return `${field} lt ${isoDateTime}`;
  }

  /**
   * Helper method to create 'contains' filter
   */
  public contains(field: string, value: string): string {
    return `contains(${field}, '${value}')`;
  }

  /**
   * Helper method to create 'startswith' filter
   */
  public startsWith(field: string, value: string): string {
    return `startswith(${field}, '${value}')`;
  }

  /**
   * Helper method to create 'endswith' filter
   */
  public endsWith(field: string, value: string): string {
    return `endswith(${field}, '${value}')`;
  }

  /**
   * Helper method to create 'in' filter (value in list)
   */
  public in(field: string, values: (string | number)[]): string {
    const formattedValues = values
      .map((v) => (typeof v === 'string' ? `'${v}'` : v))
      .join(', ');
    return `${field} in (${formattedValues})`;
  }

  /**
   * Helper method to combine multiple filters with 'and'
   */
  public and(...filters: string[]): string {
    return filters.filter((f) => f).join(' and ');
  }

  /**
   * Helper method to combine multiple filters with 'or'
   */
  public or(...filters: string[]): string {
    return filters.filter((f) => f).join(' or ');
  }

  /**
   * Helper method to create 'not' filter
   */
  public not(filter: string): string {
    return `not (${filter})`;
  }

  /**
   * Encode value for URL (handles special characters)
   */
  private encodeValue(value: string): string {
    return encodeURIComponent(value);
  }
}
