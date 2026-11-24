import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';

import {
  COMPANY_CODES,
  LEGACY_DEFAULT_COMPANY_CODE,
  normalizeCompanyCode,
  requireCompanyCode,
  resolveLegacyCompanyCode,
} from './company-code';

import { ExcelFileCompanyIdDto } from '@/common/dtos/excel-file-company-id.dto';

describe('company codes', () => {
  it('exposes exactly the two supported legal entities', () => {
    expect(Object.values(COMPANY_CODES)).toEqual(['m-p', 'mas']);
  });

  it('keeps an explicit MAS unchanged', () => {
    expect(requireCompanyCode('mas')).toBe('mas');
    expect(resolveLegacyCompanyCode('mas')).toBe('mas');
  });

  it('normalizes case and surrounding whitespace before checking support', () => {
    expect(normalizeCompanyCode('  MAS ')).toBe('mas');
    expect(normalizeCompanyCode('M-P')).toBe('m-p');
  });

  it('rejects unsupported companies instead of routing them to m-p', () => {
    expect(() => normalizeCompanyCode('acme')).toThrow(BadRequestException);
    expect(() => resolveLegacyCompanyCode('acme')).toThrow(BadRequestException);
    expect(() => requireCompanyCode('acme')).toThrow(BadRequestException);
  });

  it('rejects non-string values', () => {
    expect(() => normalizeCompanyCode(42)).toThrow(BadRequestException);
    expect(() => normalizeCompanyCode({ code: 'mas' })).toThrow(
      BadRequestException,
    );
  });

  it('requires a company for new uploads: missing and blank are rejected', () => {
    expect(() => requireCompanyCode(undefined)).toThrow(BadRequestException);
    expect(() => requireCompanyCode(null)).toThrow(BadRequestException);
    expect(() => requireCompanyCode('   ')).toThrow(BadRequestException);
  });

  it('falls back to m-p only for legacy callers that omit companyId', () => {
    expect(LEGACY_DEFAULT_COMPANY_CODE).toBe('m-p');
    expect(resolveLegacyCompanyCode(undefined)).toBe('m-p');
    expect(resolveLegacyCompanyCode(null)).toBe('m-p');
    expect(resolveLegacyCompanyCode('')).toBe('m-p');
  });
});

describe('ExcelFileCompanyIdDto validation', () => {
  const build = (companyId: unknown) => {
    const dto = new ExcelFileCompanyIdDto();
    (dto as { companyId?: unknown }).companyId = companyId;
    return dto;
  };

  it('accepts mas and m-p', async () => {
    expect(await validate(build('mas'))).toHaveLength(0);
    expect(await validate(build('m-p'))).toHaveLength(0);
  });

  it('accepts a missing companyId (legacy compatibility path)', async () => {
    expect(await validate(build(undefined))).toHaveLength(0);
  });

  it('rejects an explicit unsupported, differently-cased or blank companyId', async () => {
    expect(await validate(build('acme'))).not.toHaveLength(0);
    expect(await validate(build('MAS'))).not.toHaveLength(0);
    expect(await validate(build(''))).not.toHaveLength(0);
  });
});
