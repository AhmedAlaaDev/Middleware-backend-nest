import { BadRequestException } from '@nestjs/common';

/**
 * Legal entities (D365FO dataAreaId values) that uploads can target.
 * Company selection is independent of the target service/processor.
 */
export const COMPANY_CODES = {
  MESCO_PORT: 'm-p',
  MAS: 'mas',
} as const;

export type CompanyCode = (typeof COMPANY_CODES)[keyof typeof COMPANY_CODES];

export const SUPPORTED_COMPANY_CODES: readonly CompanyCode[] =
  Object.values(COMPANY_CODES);

/**
 * Compatibility default for legacy callers that omit companyId entirely.
 * Only a missing value (undefined, null or an empty string) falls back to this.
 * Explicit values are never replaced, and unsupported values are rejected.
 */
export const LEGACY_DEFAULT_COMPANY_CODE: CompanyCode =
  COMPANY_CODES.MESCO_PORT;

export function isSupportedCompanyCode(value: unknown): value is CompanyCode {
  return (
    typeof value === 'string' &&
    (SUPPORTED_COMPANY_CODES as readonly string[]).includes(value)
  );
}

/**
 * Returns the supported company code for an explicit value, or `undefined`
 * when the value is missing. Throws for any non-missing unsupported value.
 * Whitespace is trimmed and case is folded before the check.
 */
export function normalizeCompanyCode(value: unknown): CompanyCode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(
      `Unsupported companyId. Supported values: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') {
    return undefined;
  }
  if (!isSupportedCompanyCode(trimmed)) {
    throw new BadRequestException(
      `Unsupported companyId "${value}". Supported values: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
    );
  }
  return trimmed;
}

/**
 * Resolves the company for a new upload. Explicit values are kept as-is;
 * a missing value is rejected. Use this for every new upload or preview.
 */
export function requireCompanyCode(value: unknown): CompanyCode {
  const code = normalizeCompanyCode(value);
  if (!code) {
    throw new BadRequestException(
      `companyId is required. Supported values: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
    );
  }
  return code;
}

/**
 * Compatibility path for legacy callers that omit companyId.
 * Missing -> LEGACY_DEFAULT_COMPANY_CODE (m-p). Explicit and invalid values
 * behave exactly as in requireCompanyCode, so an explicit MAS is never
 * replaced and an unsupported company is never routed to m-p.
 */
export function resolveLegacyCompanyCode(value: unknown): CompanyCode {
  return normalizeCompanyCode(value) ?? LEGACY_DEFAULT_COMPANY_CODE;
}
