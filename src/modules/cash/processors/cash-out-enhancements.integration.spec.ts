import { readFile } from 'fs/promises';
import { join } from 'path';

import { CashEntryDynDataModel } from '@/modules/cash/models';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashOutTruckingEntryProcessor } from '@/modules/cash/processors/cash-out-trucking-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash Out enhancement workbooks - PBIs 2063/2065', () => {
  const adapter = new ExcelJsAdapter();
  const fixtureDirectory = join(
    process.cwd(),
    'src',
    'excel-sources',
    'Cash',
    'cash_out_enhancement',
  );

  const createProcessor = (target: 'Freight' | 'Fleet') => {
    const Processor =
      target === 'Freight'
        ? CashOutFreightEntryProcessor
        : CashOutTruckingEntryProcessor;
    const processor = new Processor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService: {
          load: jest.fn().mockResolvedValue(undefined),
        },
        generalJournalService: {},
      } as any,
    );
    jest
      .spyOn(processor as any, 'warmupProcessorData')
      .mockResolvedValue(undefined);
    jest
      .spyOn(processor as any, 'validateCashOutSourceAsync')
      .mockResolvedValue(undefined);
    jest
      .spyOn(processor as any, 'fetchVendorInvoiceExistsMap')
      .mockResolvedValue(undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    (processor as any).vendorNameMap = new Map();
    return processor;
  };

  const loadRows = async (fileName: string) => {
    const buffer = await readFile(join(fixtureDirectory, fileName));
    return adapter.read(buffer);
  };

  it.each(['Freight', 'Fleet'] as const)(
    'preserves every line in the NULL SafeType custody workbook for %s',
    async (target) => {
      const rows = await loadRows(
        'Custody Settlement - Jan - safetyp null.xlsx',
      );
      const result = (await createProcessor(target).formatAndEnrichAsync(
        rows,
        'm-p',
      )) as CashEntryDynDataModel[];

      expect(rows).toHaveLength(904);
      expect(result).toHaveLength(904);
      expect(new Set(result.map((line) => line.SafeType))).toEqual(
        new Set(['Custody Settlement']),
      );
      expect(result.every((line) => line.MarkedInvoice === '')).toBe(true);
    },
  );

  it.each(['Freight', 'Fleet'] as const)(
    'preserves every Custody Settlement line for %s',
    async (target) => {
      const rows = await loadRows('IN-JAN-Custody Settlement.xlsx');
      const result = (await createProcessor(target).formatAndEnrichAsync(
        rows,
        'm-p',
      )) as CashEntryDynDataModel[];

      expect(rows).toHaveLength(584);
      expect(result).toHaveLength(584);
      expect(
        result.every((line) => line.SafeType === 'Custody Settlement'),
      ).toBe(true);
    },
  );

  it.each(['Freight', 'Fleet'] as const)(
    'formats OUT-JAN by SafeType and merges Vendor Payment withholding for %s',
    async (target) => {
      const rows = (await loadRows('OUT-JAN.xlsx')) as any[];
      const result = (await createProcessor(target).formatAndEnrichAsync(
        rows,
        'm-p',
      )) as CashEntryDynDataModel[];

      const sourceVendorPayments = rows.filter(
        (row) => row.SafeType === 'Vendor Payment',
      );
      const sourceVendorDebitLines = sourceVendorPayments.filter(
        (row) =>
          String(row.ACCOUNTTYPE).toLowerCase() === 'vend' &&
          Number(row.DEBITAMOUNT) > 0,
      );
      const sourceNonVendorPayments = rows.filter(
        (row) => row.SafeType !== 'Vendor Payment',
      );
      const vendorPayments = result.filter(
        (line) => line.SafeType === 'Vendor Payment',
      );

      expect(rows).toHaveLength(4134);
      expect(vendorPayments).toHaveLength(sourceVendorDebitLines.length);
      expect(result).toHaveLength(
        sourceNonVendorPayments.length + sourceVendorDebitLines.length,
      );
      expect(vendorPayments.every((line) => line.AccountType === 'Vend')).toBe(
        true,
      );
      expect(
        vendorPayments.some(
          (line) => line.IsWithholdingCalculationEnabled === 'Yes',
        ),
      ).toBe(true);
      expect(
        vendorPayments.some(
          (line) =>
            String(line.AccountDisplayValue).startsWith('223304') ||
            String(line.OffsetAccountDisplayValue).startsWith('223304'),
        ),
      ).toBe(false);

      const mergedWithholdingGroup = vendorPayments.filter(
        (line) => line.SourceIds[0] === '468173',
      );
      expect(mergedWithholdingGroup).toHaveLength(1);
      expect(mergedWithholdingGroup[0]).toMatchObject({
        DebitAmount: 105222,
        OffsetAccountType: 'Bank',
        IsWithholdingCalculationEnabled: 'Yes',
      });

      const multiMarkingGroup = vendorPayments.filter(
        (line) => line.SourceIds[0] === '467706',
      );
      expect(multiMarkingGroup.length).toBeGreaterThan(1);
      expect(
        new Set(multiMarkingGroup.map((line) => line.MarkedInvoice)).size,
      ).toBeGreaterThan(1);

      const directLines = result.filter((line) => line.SafeType === 'Direct');
      expect(directLines).toHaveLength(
        rows.filter((row) => row.SafeType === 'Direct').length,
      );
      expect(directLines.every((line) => !line.OffsetAccountDisplayValue)).toBe(
        true,
      );
    },
  );
});
