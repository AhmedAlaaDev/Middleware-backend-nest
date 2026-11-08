/**
 * Vendor Payment golden master.
 *
 * Representative Vendor Payment uploads are run through the production
 * pipeline (processor -> posting-handler mapping and validation -> the
 * posting service's request grouping) and the full output is compared with a
 * snapshot that was GENERATED FROM THE CODE BEFORE the Custody Settlement
 * integrity work (branch tip 2e01e35), not from the current code. Any
 * difference is a Vendor Payment regression.
 *
 * Out of scope on purpose: Bank-tagged WCApp payment rows (WCA-US/WCA-EUR),
 * whose outcome was deliberately corrected; they have their own tests in
 * base-cash-entry.processor.vendor-payment-wca-offset.spec.ts.
 *
 * To regenerate (only ever from a known-good revision):
 *   GOLDEN_WRITE=1 pnpm jest vendor-payment.golden-master
 */
import * as fs from 'fs';
import * as path from 'path';

import { PostCashBatchToDFOHandler } from '@/modules/cash/handlers/post-cash-batch-to-dfo.handler';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

const GOLDEN_FILE = path.join(
  __dirname,
  '__golden__',
  'vendor-payment-baseline.golden.json',
);

const VENDOR_DIMS =
  '|1201|012|001|002|201000309|201000309|Su-000072|Su-000072|16503|5035|4022|Payable|||EXPORT||||';
const LEDGER = (main: string) =>
  `${main}|1201|012|001|002|201000293|201000293|Su-000072|Su-000072|16503|5035|4022|Payable|||EXPORT||||`;

let lineCounter = 0;
const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  UniqueId: 0,
  LINENUMBER: ++lineCounter,
  JOURNALBATCHNUMBER: null,
  JOURNALNAME: 'NP',
  DESCRIPTION: 'NP - CIB_EG_CA-127',
  VOUCHER: 'NP-000184741',
  TRANSDATE: '2026-07-04',
  ACCOUNTTYPE: '',
  ACCOUNTDISPLAYVALUE: '',
  DEFAULTDIMENSIONDISPLAYVALUE: '',
  FINTAGDISPLAYVALUE: 'O26-EXP-OC-2474|ME_Q-1|Sl-000002|Su-000072',
  TEXT: '',
  DEBITAMOUNT: 0,
  CREDITAMOUNT: 0,
  CURRENCYCODE: 'EGP',
  EXCHANGERATE: 100,
  OFFSETACCOUNTTYPE: '',
  OFFSETACCOUNTDISPLAYVALUE: '',
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE: '',
  OFFSETFINTAGDISPLAYVALUE: '',
  OFFSETTEXT: '',
  PREPAYMENT: 'No',
  SALESTAXGROUP: '',
  ITEMSALESTAXGROUP: '',
  TAXEXEMPTNUMBER: '',
  ISWITHHOLDINGCALCULATIONENABLED: 'No',
  ITEMWITHHOLDINGTAXGROUPCODE: '',
  DOCUMENT: '22709',
  DOCUMENTDATE: '2026-06-28',
  DUEDATE: '2026-07-01',
  INVOICE: '',
  PAYMENTMETHOD: '',
  PAYMENTREFERENCE: '554391135',
  POSTINGPROFILE: '',
  POSTINGLAYER: 'Current',
  ISPOSTED: 'No',
  SafeTransaction: 'Out',
  SafeType: 'Vendor Payment',
  VoucherType: 'Transfer',
  ...overrides,
});

const vendor = (
  id: number,
  account: string,
  invoice: string,
  amount: number,
  extra: Record<string, unknown> = {},
) =>
  row({
    UniqueId: id,
    ACCOUNTTYPE: 'Vend',
    ACCOUNTDISPLAYVALUE: account,
    DEFAULTDIMENSIONDISPLAYVALUE: VENDOR_DIMS,
    DEBITAMOUNT: amount,
    INVOICE: invoice,
    POSTINGPROFILE: 'V-PP',
    ...extra,
  });

const offset = (
  id: number,
  type: string,
  account: string,
  amount: number,
  extra: Record<string, unknown> = {},
) =>
  row({
    UniqueId: id,
    ACCOUNTTYPE: type,
    ACCOUNTDISPLAYVALUE: account,
    DEFAULTDIMENSIONDISPLAYVALUE: '',
    CREDITAMOUNT: amount,
    ...extra,
  });

/** Vendor Payment shapes seen in production uploads (no WCApp accounts). */
const buildFixtures = (): Record<string, unknown>[] => {
  lineCounter = 0;
  return [
    // 1. Regular bank offset.
    vendor(7001, 'Su-000072', 'ALXR000110850-C', 2724.02),
    offset(7001, 'Bank', 'CIB-EG-CA', 2724.02),
    // 2. Two suppliers and two invoices in one payment.
    vendor(7002, 'Su-000072', 'INV-A', 1000),
    vendor(7002, 'Su-000009', 'INV-B', 500.5, { DOCUMENT: '22710' }),
    offset(7002, 'Bank', 'QNB-EG-CA2', 1500.5),
    // 3. Explicit withholding: gross vendor debit, 223304 credit, net bank.
    vendor(7003, 'Sl-000036', '5815410364', 2260.62),
    offset(7003, 'Ledger', LEDGER('223304'), 59.49, {
      INVOICE: '5815410364',
    }),
    offset(7003, 'Bank', 'CIB-EG-CA', 2201.13),
    // 4. Ledger offset instead of a bank.
    vendor(7004, 'Su-000009', 'INV-C', 3850),
    offset(7004, 'Ledger', LEDGER('223201'), 3850),
    // 5. Petty cash offset.
    vendor(7005, 'Su-000009', 'INV-D', 420),
    offset(7005, 'Petty cash', 'PSD EG', 420),
    // 6. Foreign currency bank, several invoices of one vendor.
    vendor(7006, 'Ag-000191', 'EUR-1', 465, { CURRENCYCODE: 'EUR' }),
    vendor(7006, 'Ag-000191', 'EUR-2', 2106, {
      CURRENCYCODE: 'EUR',
      DOCUMENT: '22711',
    }),
    offset(7006, 'Bank', 'QNB-EU-CA2', 2571, { CURRENCYCODE: 'EUR' }),
    // 7. Visa voucher type.
    vendor(7007, 'Su-000072', 'INV-V', 99.99, { VoucherType: 'Visa' }),
    offset(7007, 'Bank', 'CIB-EG-CA', 99.99, { VoucherType: 'Visa' }),
  ];
};

const buildProcessor = (rows: Record<string, unknown>[]) => {
  const vendors = [
    ...new Set(
      rows
        .filter((r) => String(r.ACCOUNTTYPE).toLowerCase().startsWith('vend'))
        .map((r) => String(r.ACCOUNTDISPLAYVALUE)),
    ),
  ].map((account) => ({
    vendorAccountNumber: account,
    vendorGroupId: 'Normal',
  }));
  const processor: any = new CashOutFreightEntryProcessor(
    { execute: jest.fn().mockResolvedValue({ items: vendors }) } as any,
    {
      queryBus: { execute: jest.fn().mockResolvedValue({ items: vendors }) },
      exchangeRateService: {},
      utilsService: new EntryProcessorUtilsService(),
      dimensionService: new DimensionValidationService(),
      taxGroupService: {},
      freeTextInvoiceService: {},
      vendorInvoiceJournalService: {},
      cashOutExchangeRateService: {
        load: jest.fn().mockResolvedValue(undefined),
        resolveReporting: jest.fn(),
      },
    } as any,
  );
  processor.company = 'm-p';
  processor.vendorNameMap = new Map();
  jest.spyOn(processor, 'warmupProcessorData').mockResolvedValue(undefined);
  jest
    .spyOn(processor, 'collectSettlementTargetErrors')
    .mockResolvedValue(undefined);
  jest
    .spyOn(processor, 'validateDimensionsForLine')
    .mockImplementation(() => undefined);
  jest
    .spyOn(processor, 'validateCashOutMarkedInvoice')
    .mockImplementation(() => undefined);
  jest
    .spyOn(processor, 'fetchVendorInvoiceExistsMap')
    .mockResolvedValue(undefined);
  jest
    .spyOn(processor, 'fetchExchangeRates')
    .mockReturnValue({ exchangeRate: 1, reportingRate: 1 });
  return processor;
};

/** Runs the fixtures through the production path and captures everything. */
async function captureVendorPaymentOutput(): Promise<unknown> {
  const rows = buildFixtures();
  const processor = buildProcessor(rows);
  const formatted: any[] = processor.validateAsync(
    await processor.formatAndEnrichAsync(rows, 'm-p'),
    'm-p',
  );

  const handler: any = new PostCashBatchToDFOHandler(
    {} as any,
    {} as any,
    new CashJournalRoutingService(),
  );
  const byJournal = new Map<string, any[]>();
  for (const line of formatted) {
    const key = String(line.JournalBatchNumber);
    byJournal.set(key, [...(byJournal.get(key) ?? []), { data: line }]);
  }
  const journals = handler.mapToD365FOCashJournalRequests(
    byJournal,
    'm-p',
    'out',
    'Freight',
  );

  let validation: string | null = null;
  try {
    handler.validateCustomerPaymentJournals(journals);
  } catch (error: any) {
    validation = String(error?.getResponse?.()?.details ?? error?.message);
  }

  const service: any = Object.create(CustomerPaymentJournalService.prototype);
  return JSON.parse(
    JSON.stringify({
      formatted: formatted.map((line) => ({
        sourceIds: line.SourceIds,
        errors: line.GetErrors(),
        accountType: line.AccountType,
        offsetAccountType: line.OffsetAccountType,
        account: line.AccountDisplayValue,
        offsetAccount: line.OffsetAccountDisplayValue,
        debit: line.DebitAmount,
        credit: line.CreditAmount,
        currency: line.CurrencyCode,
        invoice: line.Invoice,
        markedInvoice: line.MarkedInvoice,
        markedLines: line.MarkedLines,
        settlementIntent: line.SettlementIntent,
        description: line.Description,
        journalName: line.JournalName,
        journalBatch: line.JournalBatchNumber,
        voucher: line.Voucher,
        safeType: line.SafeType,
        withholding: line.IsWithholdingCalculationEnabled,
        itemWithholdingGroup: line.ItemWithholdingTaxGroupCode,
      })),
      validation,
      journals: journals.map((journal: any) => {
        const pending = journal.lines.map((l: any) => ({
          lineNumber: l.LineNumber,
          sourceLineNumber: l.sourceLineNumber,
          groupInvoice: l.groupInvoice,
          body: l.customLineApiBody,
        }));
        return {
          route: {
            kind: journal.route?.kind,
            safeType: journal.route?.safeType,
            journalName: journal.route?.journalName,
          },
          header: journal.header,
          lines: pending,
          // The Vendor Payment path groups one request per UniqueId, never
          // split by invoice.
          requests: service
            .groupCashOutPendingLinesByUniqueId(pending, false)
            .map((request: any[]) => request.map((p) => p.lineNumber)),
        };
      }),
    }),
  );
}

describe('Vendor Payment golden master (baseline 2e01e35)', () => {
  it('produces the same output as before the Custody Settlement work', async () => {
    const actual = await captureVendorPaymentOutput();

    if (process.env.GOLDEN_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
      fs.writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, 2) + '\n');
      return;
    }

    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    expect(actual).toEqual(golden);
  });

  it('keeps one request per UniqueId (never split by invoice) with no Custody balance guard', async () => {
    const output: any = await captureVendorPaymentOutput();
    const journal = output.journals[0];

    const uniqueIds = new Set(journal.lines.map((l: any) => l.body.PAYMENTID));
    expect(journal.requests).toHaveLength(uniqueIds.size);
    // Fixture 2 has two invoices for one UniqueId: still one request.
    const multiInvoice = journal.lines
      .filter((l: any) => l.body.PAYMENTID === '7002')
      .map((l: any) => l.lineNumber);
    expect(
      journal.requests.some(
        (request: number[]) =>
          multiInvoice.length > 0 &&
          multiInvoice.every((n: number) => request.includes(n)),
      ),
    ).toBe(true);
  });

  it('keeps the explicit 223304 companion and passes posting validation', async () => {
    const output: any = await captureVendorPaymentOutput();

    expect(output.validation).toBeNull();
    const withholdingLines = output.journals[0].lines.filter(
      (l: any) => l.body.PAYMENTID === '7003',
    );
    expect(
      withholdingLines.some((l: any) =>
        String(l.body.AccountNum).startsWith('223304'),
      ) ||
        withholdingLines.some((l: any) =>
          String(l.body.offsetAccountDisplayValue ?? '').startsWith('223304'),
        ),
    ).toBe(true);
  });
});
