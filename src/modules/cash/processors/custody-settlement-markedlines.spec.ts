import { readFile } from 'fs/promises';
import { join } from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Custody Settlement MarkedLines workbook regression', () => {
  it('formats IN-JAN-Custody Settlement vendor lines and maps MarkedLines into the Cash Out API body', async () => {
    const adapter = new ExcelJsAdapter();
    const buffer = await readFile(
      join(
        process.cwd(),
        'src/excel-sources/Cash/cash_out_enhancement/IN-JAN-Custody Settlement.xlsx',
      ),
    );
    const rows = await adapter.read(buffer);

    const vendorAccounts = [
      ...new Set(
        rows
          .filter((r: any) => String(r.ACCOUNTTYPE).toLowerCase() === 'vend')
          .map((r: any) => String(r.ACCOUNTDISPLAYVALUE).trim()),
      ),
    ];

    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: {
          execute: jest.fn().mockResolvedValue({
            items: vendorAccounts.map((account) => ({
              vendorAccountNumber: account,
              vendorGroupId: /^S[ul]-/i.test(account) ? 'Trade' : 'Custody',
            })),
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
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);
    jest
      .spyOn(processor as any, 'fetchVendorInvoiceExistsMap')
      .mockResolvedValue(undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    (processor as any).vendorNameMap = new Map();

    const result = (await processor.formatAndEnrichAsync(
      rows as any,
      'm-p',
    )) as any[];

    const vendors = result.filter(
      (line) => String(line.AccountType).toLowerCase() === 'vend',
    );
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors.every((line) => line.MarkedLines?.length > 0)).toBe(true);

    const custodyVendors = vendors.filter(
      (line) => String(line.VendorGroup).toLowerCase() === 'custody',
    );
    const standardVendors = vendors.filter(
      (line) => String(line.VendorGroup).toLowerCase() !== 'custody',
    );

    expect(custodyVendors.length).toBeGreaterThan(0);
    expect(
      custodyVendors.every(
        (line) =>
          line.MarkedLines[0].InvoiceNumber === '' &&
          Boolean(line.MarkedLines[0].DocumentNumber) &&
          Boolean(line.MarkedLines[0].OperationNumber),
      ),
    ).toBe(true);

    if (standardVendors.length > 0) {
      expect(
        standardVendors.every(
          (line) =>
            line.MarkedLines[0].DocumentNumber === '' &&
            Boolean(line.MarkedLines[0].OperationNumber),
        ),
      ).toBe(true);
    }

    const handler = new PostCashBatchToDFOHandler(
      {} as any,
      {} as any,
      new CashJournalRoutingService(),
    );
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });
    const mapped = (handler as any).mapLines(
      vendors.slice(0, 10).map((line, index) => ({
        id: String(index),
        data: line,
      })),
      'm-p',
      'out',
      route,
    );

    expect(
      mapped.every(
        (line: any) => (line.customLineApiBody.MarkedLines?.length ?? 0) > 0,
      ),
    ).toBe(true);
  });
});
