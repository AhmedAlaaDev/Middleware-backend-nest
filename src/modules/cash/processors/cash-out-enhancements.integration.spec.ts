import { readFile } from 'fs/promises';
import { join } from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashEntryDynDataModel } from '@/modules/cash/models';
import { CashOutTruckingEntryProcessor } from '@/modules/cash/processors/outbound/fleet/cash-out-trucking-entry.processor';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
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
      const rows = await loadRows('OUT-JAN.xlsx');
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
      expect(vendorPayments.length).toBeLessThan(sourceVendorDebitLines.length);
      expect(result.length).toBeLessThan(
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
        DebitAmount: 104299,
        OffsetAccountType: 'Bank',
        IsWithholdingCalculationEnabled: 'Yes',
      });

      const multiMarkingGroup = vendorPayments.filter(
        (line) => line.SourceIds[0] === '467706',
      );
      expect(multiMarkingGroup).toHaveLength(1);
      expect(multiMarkingGroup[0].MarkedLines.length).toBeGreaterThan(1);
      expect(
        new Set(
          multiMarkingGroup[0].MarkedLines.map(
            (markedLine) => markedLine.InvoiceNumber,
          ),
        ).size,
      ).toBeGreaterThan(1);
      expect(
        multiMarkingGroup[0].MarkedLines.every(
          (markedLine) => markedLine.HasWithHoldingLine === true,
        ),
      ).toBe(true);

      const directLines = result.filter((line) => line.SafeType === 'Direct');
      expect(directLines).toHaveLength(
        rows.filter((row) => row.SafeType === 'Direct').length,
      );
      expect(directLines.every((line) => !line.OffsetAccountDisplayValue)).toBe(
        true,
      );

      const routing = new CashJournalRoutingService();
      const postingHandler = new PostCashBatchToDFOHandler(
        {} as any,
        {} as any,
        routing,
      );
      const postingValidationFailures = result.flatMap((line) => {
        const route = routing.resolve({
          safeType: line.SafeType,
          targetProcessor: target,
        });
        const mappedLine = (postingHandler as any).mapLines(
          [{ id: line.SourceIds[0] ?? '', data: line }],
          'm-p',
          route.lineDirection,
          route,
        )[0];
        const errors = (postingHandler as any).validateLine(mappedLine, route);
        return errors.length > 0
          ? [{ sourceIds: line.SourceIds, safeType: line.SafeType, errors }]
          : [];
      });

      expect(postingValidationFailures).toEqual([]);
    },
  );
});
