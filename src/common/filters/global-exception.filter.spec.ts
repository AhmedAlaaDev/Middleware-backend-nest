import { BadRequestException } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter validation normalization', () => {
  const createFilter = () =>
    new GlobalExceptionFilter({ emit: jest.fn() } as any);

  it('preserves Cash Out pre-format errors as frontend validation errors', () => {
    const filter = createFilter();
    const exception = new BadRequestException({
      message:
        'Cash Out pre-format validation failed. No journal request was generated.',
      errorCount: 3,
      errors: [
        'Line 17 (UniqueId 2065) account: Main account 999999 was not found.',
        'Line 17 (UniqueId 2065) offset: Cost center CC-9 was not found.',
        'UniqueId 2066: Vendor Payment requires one credit payment offset.',
      ],
    });

    const normalized = (filter as any).normalizeHttpException(exception);

    expect(normalized.validationErrors).toEqual({
      'Line 17 (UniqueId 2065) Account': ['Main account 999999 was not found.'],
      'Line 17 (UniqueId 2065) Offset': ['Cost center CC-9 was not found.'],
      'UniqueId 2066': ['Vendor Payment requires one credit payment offset.'],
    });
    expect(normalized.details).toEqual({ errorCount: 3 });
    expect(normalized.errorCode).toBe('VAL_001');
  });

  it('keeps the existing invoice validation response mapping', () => {
    const filter = createFilter();
    const exception = new BadRequestException({
      message: 'Validation failed',
      errors: [
        {
          invoiceIndex: 2,
          lineNumber: 4,
          missingFields: ['Account'],
        },
      ],
    });

    const normalized = (filter as any).normalizeHttpException(exception);

    expect(normalized.validationErrors).toEqual({
      'Invoice[2].Line[4]': ['Missing required field: Account'],
    });
  });
});
