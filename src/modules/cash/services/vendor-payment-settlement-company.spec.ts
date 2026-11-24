import { BadRequestException } from '@nestjs/common';

import { VendorPaymentSettlementImportService } from './vendor-payment-settlement-import.service';

/**
 * The settlement export carries a Company column. A selected company must match
 * every non-blank row; blanks and the legacy (no selection) path are unchanged.
 */
describe('VendorPaymentSettlementImportService company check', () => {
  const service = new VendorPaymentSettlementImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const check = (
    candidates: Array<{ excelRow: number; company: string }>,
    selected?: string,
  ) =>
    (
      service as unknown as {
        assertWorkbookMatchesCompany: (
          rows: unknown[],
          selected?: string,
        ) => void;
      }
    ).assertWorkbookMatchesCompany(candidates, selected);

  it('accepts rows for the selected company', () => {
    expect(() =>
      check(
        [
          { excelRow: 2, company: 'mas' },
          { excelRow: 3, company: 'MAS ' },
        ],
        'mas',
      ),
    ).not.toThrow();
  });

  it('rejects the whole workbook when any row belongs to another company', () => {
    expect(() =>
      check(
        [
          { excelRow: 2, company: 'mas' },
          { excelRow: 3, company: 'm-p' },
        ],
        'mas',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      check(
        [
          { excelRow: 2, company: 'mas' },
          { excelRow: 3, company: 'm-p' },
        ],
        'mas',
      ),
    ).toThrow(/row 3 \(m-p\)/);
  });

  it('does not treat blank Company cells as a mismatch', () => {
    expect(() => check([{ excelRow: 2, company: '' }], 'm-p')).not.toThrow();
  });

  it('keeps the legacy row-driven behaviour when no company is selected', () => {
    expect(() =>
      check([
        { excelRow: 2, company: 'm-p' },
        { excelRow: 3, company: 'mas' },
      ]),
    ).not.toThrow();
  });
});
