import { readFile } from 'fs/promises';
import { join } from 'path';

import { BadRequestException } from '@nestjs/common';

import {
  CASH_OUT_TEMPLATE_HEADERS,
  CashOutTemplateValidationService,
} from './cash-out-template-validation.service';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';

describe('CashOutTemplateValidationService - PBI 2063', () => {
  const service = new CashOutTemplateValidationService();
  const adapter = new ExcelJsAdapter();
  const fixtureDirectory = join(
    process.cwd(),
    'src',
    'excel-sources',
    'Cash',
    'cash_out_enhancement',
  );

  it.each([
    'Custody Settlement - Jan - safetyp null.xlsx',
    'IN-JAN-Custody Settlement.xlsx',
    'OUT-JAN.xlsx',
  ])('accepts approved workbook %s', async (fileName) => {
    const buffer = await readFile(join(fixtureDirectory, fileName));
    const sheet = await adapter.readSheet(buffer);

    expect(() => service.assertSupported(sheet.headers)).not.toThrow();
    expect(sheet.headers).toEqual(CASH_OUT_TEMPLATE_HEADERS);
    expect(sheet.rows.length).toBeGreaterThan(0);
  });

  it('reports missing, unexpected, duplicate, and blank headers clearly', () => {
    const headers = [...CASH_OUT_TEMPLATE_HEADERS];
    headers[0] = '';
    headers[1] = 'VoucherType';
    headers[2] = 'CHANGED_COLUMN';

    expect(() => service.assertSupported(headers)).toThrow(BadRequestException);
    try {
      service.assertSupported(headers);
    } catch (error) {
      const message = (error as BadRequestException).message;
      expect(message).toContain('missing columns');
      expect(message).toContain('unsupported columns: CHANGED_COLUMN');
      expect(message).toContain('duplicate columns: VoucherType');
      expect(message).toContain('blank column header');
    }
  });
});
