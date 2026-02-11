import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthKey } from '@/lib/utils';
import {
  CashOutFreightDFOLine,
  CashOutFreightDFOLineBase,
  CashOutFreightDFOHeader,
  CashOutFreightDFOSettled,
} from '@/modules/cash-out/interfaces/cash-out-freight-dfo-data.interface';
import { CashOutFreightRawData } from '@/modules/cash-out/models/cash-out-freight-raw-data.model';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetVendorsQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

type RawDataInvoiceMap = Map<string, CashOutFreightRawData[]>;

@Injectable()
export class CashOutFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(CashOutFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashOutFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'ChargeType',
    'SalesMan',
    'FreightType',
    'CoordinatorMan',
    'Direction',
    'Vendor',
    'SubVendor',
  ] as const;

  constructor(
    private readonly commandBus: CommandBus,
    customerInvoiceService: CustomerInvoiceService,
    queryBus: QueryBus,
    db: DBService,
  ) {
    super(customerInvoiceService, queryBus, db);
  }

  // --------------------------------------------------------------------------
  // FORMAT & ENRICH
  // --------------------------------------------------------------------------

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    const rawCount = data.length;
    this.procLogger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Map & sort
    const rawLines = this.mapToModels(data);

    // STEP 2: Filter custody settlements vs other lines
    const { custodySettlementLines, otherLines } =
      this.filteredSortedLines(rawLines);
    this.procLogger.debug(
      `Filtered ${rawLines.length} lines into ${custodySettlementLines.length} custody settlement lines and ${otherLines.length} other lines`,
    );

    // STEP 2.5: Run custody settlement with raw data (no file – already extracted from Excel)
    if (custodySettlementLines.length > 0) {
      this.commandBus
        .execute(
          new ProcessCustodySettlementEntryCommand(
            company,
            undefined,
            custodySettlementLines,
          ),
        )
        .catch((error) => {
          this.procLogger.error(
            `Error processing custody settlement entry: ${error}`,
          );
        });
    }

    // STEP 3: Build invoice map (by UniqueId, like cash-in)
    const invoiceMap = this.buildInvoiceMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.procLogger.debug(
      `Grouped ${otherLines.length} lines into ${invoiceCount} invoices`,
    );

    // STEP 4: Build DFO lines (debit/credit pairing, one line per credit)
    const dfoLines = await this.buildLines(invoiceMap, company);
    this.procLogger.debug(`Built ${dfoLines.length} DFO lines`);

    // STEP 5: Batch processing (rules)
    // - MAX 1000 lines per batch
    // - batch contains only invoices from the same month
    // - invoice cannot be split across batches
    const journalBatchNum = await this.getNextBatchNumber();
    const voucherNum = await this.getNextVoucherNumber();
    const updatedDfoLines = this.updateBatchAndVoucher(
      dfoLines,
      journalBatchNum,
      voucherNum,
    );
    this.procLogger.debug(`Updated DFO lines: ${updatedDfoLines.length}`);

    return updatedDfoLines as unknown as DynDataModel[];
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as CashOutFreightDFOLine[];

    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    const dimensionsMap: Record<string, IFinancialDimensionValue[]> = {};
    for (const key of this.requiredDimensions) {
      dimensionsMap[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    for (const line of lines) {
      if (line.ACCOUNTTYPE === 'Ledger') {
        this.validateMainAccount(line, mainAccounts);
      }
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      this.validateBusinessUnit(line, dimensionsMap.BusinessUnit);
      this.validateLocation(line, dimensionsMap.Location);
      this.validateSalesMan(line, dimensionsMap.SalesMan);
      this.validateFreightType(line, dimensionsMap.FreightType);
      this.validateCoordinatorMan(line, dimensionsMap.CoordinatorMan);
      this.validateDirection(line, dimensionsMap.Direction);
      this.validateVendor(line, dimensionsMap.Vendor);

      if (line.DimensionModel.subVendor) {
        this.validateSubVendor(line, dimensionsMap.SubVendor);
      }
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapToModels(data: RawDataModel[]): CashOutFreightRawData[] {
    return data.map((d) => new CashOutFreightRawData(d));
  }

  private sortLinesByLineNumber(
    lines: CashOutFreightRawData[],
  ): CashOutFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private filteredSortedLines(sortedLines: CashOutFreightRawData[]) {
    const custodySettlementLines: CashOutFreightRawData[] = [];
    const otherLines: CashOutFreightRawData[] = [];

    for (const line of sortedLines) {
      if (line.ISCUSTODYSETTLEMENT) {
        custodySettlementLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    return {
      custodySettlementLines: this.sortLinesByLineNumber(
        custodySettlementLines,
      ),
      otherLines: this.sortLinesByLineNumber(otherLines),
    };
  }

  private buildInvoiceMap(
    sortedLines: CashOutFreightRawData[],
  ): RawDataInvoiceMap {
    const invoiceMap: RawDataInvoiceMap = new Map();

    for (const line of sortedLines) {
      const uniqueId = String(line.UniqueId);
      if (!invoiceMap.has(uniqueId)) {
        invoiceMap.set(uniqueId, []);
      }
      invoiceMap.get(uniqueId)!.push(line);
    }

    return invoiceMap;
  }

  private static readonly AMOUNT_EPSILON = 1e-6;

  private async buildLines(
    invoiceMap: RawDataInvoiceMap,
    company: string,
  ): Promise<CashOutFreightDFOLine[]> {
    const dfoLines: CashOutFreightDFOLine[] = [];
    const stubHeader = new CashOutFreightDFOHeader({
      JOURNALBATCHNUMBER: '',
      CATEGORYPURPOSE: 0,
      CHARGEBEARER: 0,
      DESCRIPTION: '',
      ISPOSTED: 'No',
      JOURNALNAME: 'P-Freight',
      LOCALINSTRUMENT: 0,
      OVERRIDESALESTAX: 'No',
      SERVICELEVEL: 0,
    });

    for (const [_uniqueId, lines] of invoiceMap.entries()) {
      const debitLine = lines.find((l) => l.ISDEBIT);
      const creditLines = lines.filter((l) => l.ISCREDIT);

      if (!debitLine) {
        for (const creditLine of creditLines) {
          const dfoLine = await this.buildLineFromPair(
            null,
            creditLine,
            company,
            stubHeader,
            0,
            0,
          );
          dfoLine.AddError(
            'Invoice',
            `Invoice ${creditLine.INVOICE ?? _uniqueId} has no debit line.`,
          );
          dfoLines.push(dfoLine);
        }
        if (creditLines.length === 0 && lines[0]) {
          const placeholder = lines[0];
          const dfoLine = await this.buildLineFromPair(
            placeholder,
            placeholder,
            company,
            stubHeader,
            0,
            0,
            true,
          );
          dfoLine.AddError(
            'Invoice',
            `Invoice ${placeholder.INVOICE ?? _uniqueId} has no debit and no credit lines.`,
          );
          dfoLines.push(dfoLine);
        }
        continue;
      }

      if (creditLines.length === 0) {
        const dfoLine = await this.buildLineFromPair(
          debitLine,
          debitLine,
          company,
          stubHeader,
          0,
          0,
          true,
        );
        dfoLine.AddError(
          'Invoice',
          `Invoice ${debitLine.INVOICE ?? _uniqueId} has no credit lines.`,
        );
        dfoLines.push(dfoLine);
        continue;
      }

      const totalDebit = debitLine.DEBITAMOUNT;
      const totalCredit = creditLines.reduce(
        (sum, c) => sum + c.CREDITAMOUNT,
        0,
      );
      const amountsMatch =
        Math.abs(totalDebit - totalCredit) <
        CashOutFreightEntryProcessor.AMOUNT_EPSILON;
      const balanceError = !amountsMatch
        ? `Total credit (${totalCredit}) does not match debit (${totalDebit}) for invoice ${debitLine.INVOICE ?? _uniqueId}.`
        : null;

      for (const creditLine of creditLines) {
        const dfoLine = await this.buildLineFromPair(
          debitLine,
          creditLine,
          company,
          stubHeader,
          0,
          0,
        );
        if (balanceError) {
          dfoLine.AddError('Invoice', balanceError);
        }
        dfoLines.push(dfoLine);
      }
    }
    return dfoLines;
  }

  private updateBatchAndVoucher(
    dfoLines: CashOutFreightDFOLine[],
    journalBatchNum: number,
    voucherNum: number,
  ): CashOutFreightDFOLine[] {
    const invoiceMap = new Map<string, CashOutFreightDFOLine[]>();
    for (const line of dfoLines) {
      const uniqueId = String(line.PAYMENTID);
      if (!invoiceMap.has(uniqueId)) {
        invoiceMap.set(uniqueId, []);
      }
      invoiceMap.get(uniqueId)!.push(line);
    }

    const updatedMap = new Map<string, CashOutFreightDFOLine[]>();
    let currentBatchMonth: string | null = null;
    let currentBatchLineCount = 0;
    let currentBatchNumber = journalBatchNum;
    let currentVoucherNum = voucherNum;
    let lineNumberInBatch = 1;

    const entriesByMonth = Array.from(invoiceMap.entries()).sort(
      (a, b) =>
        getMonthKey(a[1][0].TRANSACTIONDATE).localeCompare(
          getMonthKey(b[1][0].TRANSACTIONDATE),
        ) || a[0].localeCompare(b[0]),
    );

    for (const [uniqueId, lines] of entriesByMonth) {
      if (!lines || lines.length === 0) continue;

      const headerLine = lines[0];
      const invoiceMonth = getMonthKey(headerLine.TRANSACTIONDATE);

      const invoiceLineCount = lines.length;
      const monthChanged = currentBatchMonth !== invoiceMonth;
      const wouldExceedLimit =
        currentBatchLineCount + invoiceLineCount > this.MAX_LINES_PER_BATCH;

      if (monthChanged || wouldExceedLimit) {
        if (currentBatchMonth !== null) {
          currentBatchNumber++;
        }
        currentBatchMonth = invoiceMonth;
        currentBatchLineCount = 0;
        lineNumberInBatch = 1;
      }

      if (invoiceLineCount > this.MAX_LINES_PER_BATCH) {
        this.procLogger.warn(
          `Invoice ${headerLine.MARKEDINVOICE ?? uniqueId} has ${invoiceLineCount} lines (> ${this.MAX_LINES_PER_BATCH}). Keeping it in a single batch.`,
        );
      }

      const formattedBatch = this.formatBatchNumber(currentBatchNumber);
      const newHeader = new CashOutFreightDFOHeader({
        JOURNALBATCHNUMBER: formattedBatch,
        CATEGORYPURPOSE: 0,
        CHARGEBEARER: 0,
        DESCRIPTION: `Vendor Payment  Freight ${formatToMonthYear(headerLine.TRANSACTIONDATE)}`,
        ISPOSTED: 'No',
        JOURNALNAME: 'P-Freight',
        LOCALINSTRUMENT: 0,
        OVERRIDESALESTAX: 'No',
        SERVICELEVEL: 0,
      });

      const formattedVoucher = this.formatVoucherNumber(
        currentVoucherNum,
        'P-Freight',
      );

      const updatedLines: CashOutFreightDFOLine[] = [];
      for (const line of lines) {
        line.header = newHeader;
        line.JOURNALBATCHNUMBER = formattedBatch;
        line.VOUCHER = formattedVoucher;
        line.LINENUMBER = String(lineNumberInBatch);
        line.LineNumber = lineNumberInBatch;
        line.settled.JOURNALBATCHNUMBER = formattedBatch;
        line.settled.JOURNALLINENUMBER = String(lineNumberInBatch);
        updatedLines.push(line);
        currentBatchLineCount++;
        lineNumberInBatch++;
      }
      currentVoucherNum++;
      updatedMap.set(uniqueId, updatedLines);
    }

    return Array.from(updatedMap.values()).flat();
  }

  private async buildLineFromPair(
    debitLine: CashOutFreightRawData | null,
    creditLine: CashOutFreightRawData,
    company: string,
    header: CashOutFreightDFOHeader,
    voucher: number,
    lineNumber: number,
    useDebitAmounts = false,
  ): Promise<CashOutFreightDFOLine> {
    const lineAmount = useDebitAmounts
      ? creditLine.DEBITAMOUNT
      : creditLine.CREDITAMOUNT;

    const dims = this.parseToDimensions(
      creditLine.ISLEDGER
        ? creditLine.ACCOUNTDISPLAYVALUE || ''
        : creditLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
    );

    const settled = new CashOutFreightDFOSettled({
      JOURNALLINECOMPANY: company,
      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      JOURNALLINENUMBER: String(lineNumber),
      INVOICENUMBER: String(creditLine.INVOICE || ''),
      INVOICECOMPANY: company,
      INVOICEDUEDATE: '',
      ACCOUNTDISPLAYVALUE: String(creditLine.ACCOUNTDISPLAYVALUE || ''),
      CASHDISCOUNTTOTAKEININVOICECURRENCY: 0,
      INVOICEACCOUNT: String(creditLine.ACCOUNTDISPLAYVALUE || ''),
      INVOICETOPAYMENTCROSSRATE: 0,
      SETTLEMENTAMOUNTININVOICECURRENCY: lineAmount,
      SourceIds: [String(creditLine.UniqueId)],
    });

    const vendorName = await this.getVendorName(
      creditLine.ACCOUNTTYPE,
      creditLine.ACCOUNTDISPLAYVALUE,
      company,
    );

    const ov = this.buildSafeTypeOverrides(creditLine, company);
    const paymentReference = String(
      creditLine.PAYMENTREFERENCE || creditLine.DESCRIPTION || '',
    );

    const payload: CashOutFreightDFOLineBase = {
      header,
      settled,
      LineNumber: lineNumber,
      DimensionModel: dims,

      JOURNALBATCHNUMBER: header.JOURNALBATCHNUMBER,
      LINENUMBER: String(lineNumber),

      ACCOUNTDISPLAYVALUE: String(creditLine.ACCOUNTDISPLAYVALUE || ''),
      ACCOUNTTYPE: String(creditLine.ACCOUNTTYPE || ''),

      BANKTRANSACTIONTYPE: '',

      CALCULATEWITHHOLDINGTAX: creditLine.ISWITHHOLDINGCALCULATIONENABLED
        ? 'Yes'
        : 'No',

      CATEGORYPURPOSE: '',
      CENTRALBANKIMPORTDATE: '',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',
      CHARGEBEARER: '',

      CHECKNUMBER: paymentReference,
      COMPANY: company,

      CREDITAMOUNT: lineAmount,
      CURRENCYCODE: String(creditLine.CURRENCYCODE || ''),
      DEBITAMOUNT: lineAmount,

      DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: String(
        creditLine.DEFAULTDIMENSIONDISPLAYVALUE || '',
      ),
      DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: String(
        debitLine?.OFFSETDEFAULTDIMENSIONDISPLAYVALUE ||
          debitLine?.DEFAULTDIMENSIONDISPLAYVALUE ||
          creditLine.DEFAULTDIMENSIONDISPLAYVALUE ||
          '',
      ),

      ERRORCODEPAYMENT: '',

      EXCHANGERATE: Number(creditLine.EXCHANGERATE || 1),
      FINTAGDISPLAYVALUE: String(creditLine.FINTAGDISPLAYVALUE || ''),

      FULLPRIMARYREMITTANCEADDRESS: '',

      ISPREPAYMENT: 'No',

      ITEMWITHHOLDINGTAXGROUPCODE: String(
        creditLine.ITEMWITHHOLDINGTAXGROUPCODE || '',
      ),

      LOCALINSTRUMENT: '',

      MARKEDINVOICE: ov.MARKEDINVOICE,
      MARKEDINVOICECOMPANY: ov.MARKEDINVOICECOMPANY,

      NACHAIATFOREIGNEXCHANGEINDICATOR: '',
      NACHAIATFOREIGNEXCHANGEREFERENCE: '',
      NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: '',
      NACHAIATOFACSCREENINGINDICATOR: '',
      NACHAIATOFACSECONDARYSCREENINGINDICATOR: '',
      NACHAIATORIGINATINGDFIQUALIFIER: '',
      NACHAIATRECEIVINGDFIQUALIFIER: '',

      NEWJOURNALBATCHNUMBER: '',

      OFFSETACCOUNTDISPLAYVALUE: String(
        debitLine?.ACCOUNTDISPLAYVALUE ||
          creditLine.OFFSETACCOUNTDISPLAYVALUE ||
          '',
      ),
      OFFSETACCOUNTTYPE: String(
        debitLine?.ACCOUNTTYPE || creditLine.OFFSETACCOUNTTYPE || '',
      ),
      OFFSETCOMPANY: company,

      OFFSETFINTAGDISPLAYVALUE: String(
        debitLine?.OFFSETFINTAGDISPLAYVALUE ||
          creditLine.OFFSETFINTAGDISPLAYVALUE ||
          '',
      ),
      OFFSETTRANSACTIONTEXT: String(
        debitLine?.OFFSETTEXT || creditLine.OFFSETTEXT || creditLine.TEXT || '',
      ),

      OVERRIDESALESTAX: String(creditLine.OVERRIDESALESTAX || ''),

      PAYMENTID: String(creditLine.UniqueId || ''),
      PAYMENTMETHODNAME: String(creditLine.PAYMENTMETHOD || ''),
      PAYMENTREFERENCE: paymentReference,

      PAYMENTSPECIFICATION: '',

      POSTDATEDCHECKBANKBRANCH: '',
      POSTDATEDCHECKBANKNAME: '',
      POSTDATEDCHECKCASHIERDISPLAYVALUE: '',
      POSTDATEDCHECKISREPLACEMENTCHECK: '',
      POSTDATEDCHECKMATURITYDATE: '',
      POSTDATEDCHECKNUMBER: '',
      POSTDATEDCHECKORIGINALCHECKNUMBER: '',
      POSTDATEDCHECKREASONFORSTOP: '',
      POSTDATEDCHECKRECEIVEDDATE: '',
      POSTDATEDCHECKREPLACEMENTCOMMENTS: '',
      POSTDATEDCHECKSALESPERSONDISPLAYVALUE: '',
      POSTDATEDCHECKSTOPPAYMENT: '',

      POSTINGPROFILE: ov.POSTINGPROFILE,

      REMITTANCEADDRESSCITY: '',
      REMITTANCEADDRESSCOUNTRY: '',
      REMITTANCEADDRESSCOUNTRYISOCODE: '',
      REMITTANCEADDRESSCOUNTY: '',
      REMITTANCEADDRESSDESCRIPTION: '',
      REMITTANCEADDRESSDISTRICTNAME: '',
      REMITTANCEADDRESSLATITUDE: '',
      REMITTANCEADDRESSLONGITUDE: '',
      REMITTANCEADDRESSSTATE: '',
      REMITTANCEADDRESSSTREET: '',
      REMITTANCEADDRESSTIMEZONE: '',
      REMITTANCEADDRESSVALIDFROM: '',
      REMITTANCEADDRESSVALIDTO: '',
      REMITTANCEADDRESSZIPCODE: '',
      REMITTANCELOCATIONID: '',

      REPORTINGCURRENCYEXCHRATE: '',
      REPORTINGCURRENCYEXCHRATESECONDARY: '',
      SECONDARYEXCHANGERATE: '',

      SERVICELEVEL: '',

      SETTLEVOUCHER: '',

      TAXGROUP: String(creditLine.SALESTAXGROUP || ''),
      TAXITEMGROUP: String(creditLine.ITEMSALESTAXGROUP || ''),
      TAXWITHHOLDGROUP: String(creditLine.ITEMWITHHOLDINGTAXGROUPCODE || ''),

      THIRDPARTYBANKACCOUNTID: '',

      TRANSACTIONDATE: String(creditLine.TRANSDATE || ''),
      TRANSACTIONTEXT: String(creditLine.TEXT || ''),

      VOUCHER: this.formatVoucherNumber(
        voucher,
        String(creditLine.JOURNALNAME || 'P-Freight'),
      ),

      USESALESTAXDIRECTIONFROMMAINACCOUNT: 'No',

      VENDORNAME: vendorName,

      SourceIds: [String(creditLine.UniqueId)],
    };

    return new CashOutFreightDFOLine(payload);
  }

  /**
   * Builds the per-safe-type differences based on your templates:
   * - Direct: MARKEDINVOICE blank
   * - Custody Issue / Custody Settlement: MARKEDINVOICE = INVOICE, MARKEDINVOICECOMPANY = company
   * - Posting profile always from raw 46
   */
  private buildSafeTypeOverrides(raw: CashOutFreightRawData, company: string) {
    const isCustody = raw.ISCUSTODYISSUE || raw.ISCUSTODYSETTLEMENT;

    return {
      MARKEDINVOICE: isCustody ? String(raw.INVOICE || '') : '',
      MARKEDINVOICECOMPANY: isCustody ? company : '',
      POSTINGPROFILE: String(raw.POSTINGPROFILE || ''),
    };
  }

  private async getVendorName(
    accountType: string,
    accountDisplayValue: string,
    company: string,
  ): Promise<string> {
    if (accountType.toLowerCase() !== 'vend') return '';

    const vendors = await this.queryBus.execute(
      new GetVendorsQuery({
        company: company,
        accountNumbers: [accountDisplayValue],
      }),
    );

    return vendors?.items[0]?.vendorOrganizationName || '';
  }

  private createBatchHeader(
    line: CashOutFreightRawData,
    journalBatchNum: number,
  ): CashOutFreightDFOHeader {
    const formattedDate = formatToMonthYear(line.TRANSDATE);

    return new CashOutFreightDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      CATEGORYPURPOSE: 0,
      CHARGEBEARER: 0,
      DESCRIPTION: `Vendor Payment  Freight ${formattedDate}`,
      ISPOSTED: 'No',
      JOURNALNAME: 'P-Freight',
      LOCALINSTRUMENT: 0,
      OVERRIDESALESTAX: 'No',
      SERVICELEVEL: 0,
    });
  }

  private async getNextBatchNumber(): Promise<number> {
    const value =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.batch.number'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }

  private async getNextVoucherNumber(): Promise<number> {
    const value =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.voucher.cash.out.freight'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }
}
