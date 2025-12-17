import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthKey } from '@/lib/utils';
import {
  CashInFreightDFOLine,
  CashInFreightDFOHeader,
  CashInFreightDFOSettled,
} from '@/modules/cash-in/interfaces/cash-in-freight-dfo-data.interface';
import { CashInFreightRawData } from '@/modules/cash-in/models/cash-in-freight-raw-data.model';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(CashInFreightEntryProcessor.name);

  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
  ] as const;

  constructor(
    customerInvoiceService: CustomerInvoiceService,
    queryBus: QueryBus,
    db: DBService,
  ) {
    super(customerInvoiceService, queryBus, db);
  }

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    const rawLines = data.map((d) => new CashInFreightRawData(d));
    const sorted = [...rawLines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);

    const monthMap = this.groupByMonth(sorted);

    const enriched: CashInFreightDFOLine[] = [];

    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();

    let currentMonth: string | null = null;
    let currentHeader: CashInFreightDFOHeader | null = null;
    let currentBatchLines: CashInFreightDFOLine[] = [];

    const voucherNumberMap = new Map<string, number>();

    let lineNumber = 1;

    for (const [monthKey, monthLines] of monthMap.entries()) {
      for (const line of monthLines) {
        const monthChanged = currentMonth !== monthKey;
        const wouldExceedLimit =
          currentBatchLines.length + 1 > this.MAX_LINES_PER_BATCH;

        if (monthChanged || wouldExceedLimit || currentHeader === null) {
          if (currentBatchLines.length > 0 && currentHeader) {
            enriched.push(...currentBatchLines);
            currentBatchLines = [];
            journalBatchNum++;
          }

          currentMonth = monthKey;
          currentHeader = this.createBatchHeader(line, journalBatchNum);
          lineNumber = 1;
        }

        const voucherKey =
          (line.VOUCHER || '').trim() || `uid-${line.UniqueId}`;
        let assignedVoucherNum = voucherNumberMap.get(voucherKey);
        if (!assignedVoucherNum) {
          assignedVoucherNum = voucherNum++;
          voucherNumberMap.set(voucherKey, assignedVoucherNum);
        }

        const dims = this.parseToDimensions(
          line.ISLEDGER
            ? line.ACCOUNTDISPLAYVALUE || ''
            : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
        );

        const amount = Number(line.CREDITAMOUNT || 0);

        const settled = new CashInFreightDFOSettled({
          JOURNALLINECOMPANY: company,
          JOURNALBATCHNUMBER: currentHeader.JOURNALBATCHNUMBER,
          JOURNALLINENUMBER: String(lineNumber),
          INVOICENUMBER: String(line.INVOICE || ''),
          INVOICECOMPANY: company,
          INVOICEDUEDATE: '',
          ACCOUNTDISPLAYVALUE: String(line.ACCOUNTDISPLAYVALUE || ''),
          CASHDISCOUNTTOTAKEININVOICECURRENCY: 0,
          INVOICEACCOUNT: String(line.ACCOUNTTYPE || ''),
          INVOICETOPAYMENTCROSSRATE: 0,
          SETTLEMENTAMOUNTININVOICECURRENCY: amount,
          SourceIds: [String(line.UniqueId)],
        });

        const enrichedLine = new CashInFreightDFOLine({
          header: currentHeader,
          settled,
          LineNumber: lineNumber,
          DimensionModel: dims,

          JOURNALBATCHNUMBER: currentHeader.JOURNALBATCHNUMBER,
          LINENUMBER: String(lineNumber),

          ACCOUNTDISPLAYVALUE: String(line.ACCOUNTDISPLAYVALUE || ''),
          ACCOUNTTYPE: String(line.ACCOUNTTYPE || ''),

          BANKTRANSACTIONTYPE: line.VoucherType || '',
          CALCULATEWITHHOLDINGTAX: 'No',

          CENTRALBANKIMPORTDATE: '',
          CENTRALBANKPURPOSECODE: '',
          CENTRALBANKPURPOSETEXT: '',

          COMPANY: company,

          CREDITAMOUNT: Number(line.CREDITAMOUNT || 0),
          CURRENCYCODE: String(line.CURRENCYCODE || ''),

          CUSTOMERNAME: '', // TODO: add customer name

          DEBITAMOUNT: Number(line.DEBITAMOUNT || 0),

          DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: String(
            line.DEFAULTDIMENSIONDISPLAYVALUE || '',
          ),
          DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: String(
            line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE || '',
          ),

          DEPOSITNUMBER: '',

          EXCHANGERATE: Number(line.EXCHANGERATE || 1),

          FINTAGDISPLAYVALUE: line.FINTAGDISPLAYVALUE,

          ISPREPAYMENT: 'No',

          ITEMWITHHOLDINGTAXGROUP: '', // TODO: add item with holding tax group
          MARKEDINVOICE: String(line.INVOICE || ''),
          MARKEDINVOICECOMPANY: company,

          NACHAIATFOREIGNEXCHANGEINDICATOR: '',
          NACHAIATFOREIGNEXCHANGEREFERENCE: '',
          NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: '',
          NACHAIATOFACSCREENINGINDICATOR: '',
          NACHAIATOFACSECONDARYSCREENINGINDICATOR: '',
          NACHAIATORIGINATINGDFIQUALIFIER: '',
          NACHAIATRECEIVINGDFIQUALIFIER: '',

          OFFSETACCOUNTDISPLAYVALUE: String(line.ACCOUNTDISPLAYVALUE || ''),
          OFFSETACCOUNTTYPE: String(line.ACCOUNTTYPE || ''),
          OFFSETCOMPANY: company,

          OFFSETFINTAGDISPLAYVALUE: String(line.FINTAGDISPLAYVALUE || ''),
          OFFSETTRANSACTIONTEXT: String(line.TEXT || ''),

          OVERRIDESALESTAX: '',

          PAYMENTID: String(line.UniqueId || ''),
          PAYMENTMETHODNAME: String(line.VoucherType || ''),
          PAYMENTNOTES: '',
          PAYMENTREFERENCE: line.DESCRIPTION || '',
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

          POSTINGPROFILE: 'Cust-PP',

          REPORTINGCURRENCYEXCHRATE: '',
          REPORTINGCURRENCYEXCHRATESECONDARY: '',

          SECONDARYEXCHANGERATE: '',
          SETTLEVOUCHER: '',

          TAXGROUP: '',
          TAXITEMGROUP: '',

          THIRDPARTYBANKACCOUNTID: '',

          TRANSACTIONDATE: String(line.TRANSDATE || ''),
          TRANSACTIONTEXT: '',
          VOUCHER: this.formatVoucherNumber(
            assignedVoucherNum,
            String(line.JOURNALNAME || 'CashIn'),
          ),

          USEABANKDEPOSITSLIP: '',
          USESALESTAXDIRECTIONFROMMAINACCOUNT: '',

          SourceIds: [String(line.UniqueId)],
        } as any);

        currentBatchLines.push(enrichedLine);
        lineNumber++;
      }
    }

    if (currentBatchLines.length > 0) {
      enriched.push(...currentBatchLines);
    }

    this.procLogger.debug(
      `Cash-in freight enriched lines=${enriched.length} batches~=${journalBatchNum}`,
    );

    return enriched as unknown as DynDataModel[];
  }

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as CashInFreightDFOLine[];

    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    const dimensionsMap: Record<string, IFinancialDimensionValue[]> = {};
    for (const key of this.requiredDimensions) {
      dimensionsMap[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    for (const line of lines) {
      this.validateMainAccount(line, mainAccounts);
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      this.validateBusinessUnit(line, dimensionsMap.BusinessUnit);
      this.validateLocation(line, dimensionsMap.Location);
      this.validateCustomerDimension(line, dimensionsMap.Customer);
      this.validateSubCustomerDimension(line, dimensionsMap.SubCustomer);
      this.validateChargeTypeDimension(
        line,
        dimensionsMap.ChargeType.map((d) => d.value || '').filter(Boolean),
      );
      this.validateSalesMan(line, dimensionsMap.SalesMan);
      this.validateCoordinatorMan(line, dimensionsMap.CoordinatorMan);
      this.validateFreightType(line, dimensionsMap.FreightType);
      this.validateDirection(line, dimensionsMap.Direction);
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  private groupByMonth(
    lines: CashInFreightRawData[],
  ): Map<string, CashInFreightRawData[]> {
    const monthMap = new Map<string, CashInFreightRawData[]>();

    for (const line of lines) {
      let monthKey: string;
      try {
        monthKey = getMonthKey(line.TRANSDATE);
      } catch {
        monthKey = 'invalid-date';
      }

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, []);
      }

      monthMap.get(monthKey)!.push(line);
    }

    return monthMap;
  }

  private createBatchHeader(
    line: CashInFreightRawData,
    journalBatchNum: number,
  ): CashInFreightDFOHeader {
    const formattedDate = formatToMonthYear(line.TRANSDATE);

    return new CashInFreightDFOHeader({
      JOURNALBATCHNUMBER: this.formatBatchNumber(journalBatchNum),
      DESCRIPTION: `Customer Collection Freight ${formattedDate}`,
      ISPOSTED: 'No',
      JOURNALNAME: 'Cust-Pay',
      OVERRIDESALESTAX: 'No',
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
          new GetSettingQuery('last.ledger.voucher.cash.in.freight'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }
}
