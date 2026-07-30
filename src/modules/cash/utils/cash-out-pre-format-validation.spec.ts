import { BadRequestException } from '@nestjs/common';

import { getCashOutPreFormatValidationErrors } from '@/modules/cash/utils/cash-out-pre-format-validation';

describe(getCashOutPreFormatValidationErrors.name, () => {
  it('recognizes only the Cash Out pre-format validation response', () => {
    const errors = ['Line 3 (UniqueId 466596): invalid SafeType.'];
    const exception = new BadRequestException({
      message:
        'Cash Out pre-format validation failed. No journal request was generated.',
      errorCount: errors.length,
      errors,
    });

    expect(getCashOutPreFormatValidationErrors(exception)).toEqual(errors);
    expect(
      getCashOutPreFormatValidationErrors(
        new BadRequestException('Unsupported template'),
      ),
    ).toBeNull();
    expect(
      getCashOutPreFormatValidationErrors(new Error('D365 failed')),
    ).toBeNull();
  });
});
