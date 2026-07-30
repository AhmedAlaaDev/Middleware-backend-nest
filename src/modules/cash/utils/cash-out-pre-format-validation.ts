import { BadRequestException } from '@nestjs/common';

interface CashOutPreFormatValidationResponse {
  errors: string[];
  message: string;
}

export function getCashOutPreFormatValidationErrors(
  error: unknown,
): string[] | null {
  if (!(error instanceof BadRequestException)) return null;

  const response = error.getResponse();
  if (!response || typeof response !== 'object') return null;

  const candidate = response as Partial<CashOutPreFormatValidationResponse>;
  if (
    candidate.message !==
      'Cash Out pre-format validation failed. No journal request was generated.' ||
    !Array.isArray(candidate.errors) ||
    !candidate.errors.every((item) => typeof item === 'string')
  ) {
    return null;
  }

  return candidate.errors;
}
