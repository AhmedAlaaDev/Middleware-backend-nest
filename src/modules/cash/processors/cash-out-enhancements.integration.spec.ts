import { readFile } from 'fs/promises';
import { join } from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashEntryDynDataModel } from '@/modules/cash/models';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashOutTruckingEntryProcessor } from '@/modules/cash/processors/cash-out-trucking-entry.processor';
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
        queryBus: {
          execute: jest.fn().mockImplementation((query: any) => {
            const accounts = query?.payload?.accountNumbers ?? [];
            return Promise.resolve({
              items: accounts.map((account: string) => ({
                vendorAccountNumber: account,
                vendorGroupId: 'Custody',
              })),
            });
          }),
        },
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
      .mockImplementation(async (lines: any[]) => {
        for (const line of lines) {
          if (line.IsVendor) {
            line.VendorGroup = 'Custody';
            line.IsCustodyVendor = true;
          }
        }
      });
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
      const vendorPayments = result.filter(
        (line) => line.SafeType === 'Vendor Payment',
      );

      expect(rows).toHaveLength(4134);
      // Vendor Payment emits one FO line per vendor debit (payment as offset)
      // plus one FO line per matched 223304 withholding credit.
      const sourceWithholdingLines = sourceVendorPayments.filter(
        (row) =>
          String(row.ACCOUNTTYPE).toLowerCase() === 'ledger' &&
          String(row.ACCOUNTDISPLAYVALUE ?? '')
            .split('|')[0]
            .startsWith('223304') &&
          Number(row.CREDITAMOUNT) > 0,
      );
      expect(vendorPayments.length).toBeGreaterThanOrEqual(
        sourceVendorDebitLines.length + sourceWithholdingLines.length,
      );
      expect(vendorPayments.every((line) => line.AccountType === 'Vend')).toBe(
        true,
      );
      expect(
        vendorPayments.every(
          (line) => line.IsWithholdingCalculationEnabled === 'No',
        ),
      ).toBe(true);
      expect(
        vendorPayments.some((line) =>
          String(line.OffsetAccountDisplayValue ?? '')
            .split('|')[0]
            .startsWith('223304'),
        ),
      ).toBe(true);
      expect(
        vendorPayments.every(
          (line) =>
            !String(line.AccountDisplayValue ?? '')
              .split('|')[0]
              .startsWith('223304'),
        ),
      ).toBe(true);

      const withholdingGroup = vendorPayments.filter(
        (line) => line.SourceIds[0] === '468173',
      );
      expect(withholdingGroup).toHaveLength(2);
      const bankPaymentLine = withholdingGroup.find(
        (line) => line.OffsetAccountType === 'Bank',
      );
      const withholdingOffsetLine = withholdingGroup.find((line) =>
        String(line.OffsetAccountDisplayValue ?? '')
          .split('|')[0]
          .startsWith('223304'),
      );
      expect(bankPaymentLine).toMatchObject({
        DebitAmount: 104299,
        CreditAmount: 0,
        OffsetAccountType: 'Bank',
        IsWithholdingCalculationEnabled: 'No',
      });
      expect(withholdingOffsetLine).toMatchObject({
        DebitAmount: 923,
        CreditAmount: 0,
      });

      const multiVendorGroup = vendorPayments.filter(
        (line) => line.SourceIds[0] === '467706',
      );
      const multiVendorPaymentLines = multiVendorGroup.filter(
        (line) =>
          !String(line.OffsetAccountDisplayValue ?? '')
            .split('|')[0]
            .startsWith('223304'),
      );
      const multiVendorWithholdingLines = multiVendorGroup.filter((line) =>
        String(line.OffsetAccountDisplayValue ?? '')
          .split('|')[0]
          .startsWith('223304'),
      );
      expect(multiVendorPaymentLines.length).toBeGreaterThan(1);
      expect(multiVendorWithholdingLines.length).toBeGreaterThan(1);
      expect(
        new Set(multiVendorPaymentLines.map((line) => line.DebitAmount)).size,
      ).toBeGreaterThan(1);
      // Shared payment credit must never overwrite individual vendor debits.
      expect(
        multiVendorPaymentLines.every((line) => line.DebitAmount !== 41991.3),
      ).toBe(true);
      expect(
        multiVendorPaymentLines.every((line) => line.CreditAmount === 0),
      ).toBe(true);
      expect(sourceWithholdingLines.length).toBeGreaterThan(0);

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
