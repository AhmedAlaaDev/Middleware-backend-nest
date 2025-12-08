import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { formatToMonthYear, getMonthRange } from '@/lib/utils';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  RawDataModel,
  DynDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetExchangeRatesQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';
import {
  IVendorTruckingDFOHeader,
  IVendorTruckingDFOLine,
} from '@/modules/vendor/interfaces/vendor-trucking-dfo-data.interface';
import { VendorTruckingRawData } from '@/modules/vendor/models/vendor-trucking-raw-data.model';

@Injectable()
export class VendorTruckingEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType = EntryProcessorTypes.VendorTrucking;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
    'TruckerType',
    'TruckNumber',
    'Vendor',
    'SubVendor',
    'Worker',
  ] as const;

  constructor(
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
    const grouped = this.groupByUniqueId(
      data.map((d) => new VendorTruckingRawData(d)),
    );

    const eData: IVendorTruckingDFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();

    for (const [uniqueId, lines] of grouped.entries()) {
      const headerLine = lines[0];
      const dateString = headerLine.TRANSDATE;
      const formattedDate = formatToMonthYear(dateString);

      const exchangeRate = await this.getExchangeRate(
        headerLine.CURRENCYCODE,
        dateString,
        true,
      );

      const reportingRate = await this.getExchangeRate(
        headerLine.CURRENCYCODE,
        dateString,
        false,
      );

      const header = new IVendorTruckingDFOHeader({
        journalBatchNum,
        description: `Vendor Invoice Fleet ${formattedDate}`,
        isPosted: headerLine.ISPOSTED,
        journalName: headerLine.JOURNALNAME,
        journalTotalCredit: 0,
        journalTotalDebit: 0,
        oversideSalesTax: false,
        salesTaxIncluded: true,
      });

      const lineObjects = this.buildLines(
        lines,
        header,
        company,
        exchangeRate,
        reportingRate,
        uniqueId,
        () => ++voucherNum,
      );

      header.journalTotalCredit = lineObjects.reduce(
        (sum, l) => sum + (l.credit ?? 0),
        0,
      );
      header.journalTotalDebit = lineObjects.reduce(
        (sum, l) => sum + (l.debit ?? 0),
        0,
      );

      eData.push(...lineObjects);
      journalBatchNum++;
    }

    return eData as unknown as DynDataModel[];
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as IVendorTruckingDFOLine[];

    const dimensionsMap = await this.loadDimensionsMap();
    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    for (const line of lines) {
      this.validateMainAccount(line, mainAccounts);
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      this.validateBusinessUnit(line, dimensionsMap.BusinessUnit);
      this.validateLocation(line, dimensionsMap.Location);
      this.validateSalesMan(line, dimensionsMap.SalesMan);
      this.validateFreightType(line, dimensionsMap.FreightType);
      this.validateCoordinatorMan(line, dimensionsMap.CoordinatorMan);
      this.validateDirection(line, dimensionsMap.Direction);
      this.validateVendor(line, dimensionsMap.Vendor);
      this.validateTruckerType(line, dimensionsMap.TruckerType);
      this.validateTruckNumber(line, dimensionsMap.TruckNumber);
      this.validateWorker(line, dimensionsMap.Worker);

      if (line.dimensionModel.subVendor) {
        this.validateSubVendor(line, dimensionsMap.SubVendor);
      }
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private groupByUniqueId(lines: VendorTruckingRawData[]) {
    const sorted = [...lines].sort((a, b) => a.UniqueId - b.UniqueId);
    const grouped = new Map<string, VendorTruckingRawData[]>();

    sorted.forEach((line) => {
      const id = line.UniqueId.toString();
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id)!.push(line);
    });

    return grouped;
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
          new GetSettingQuery('last.ledger.vendor.freight.voucher.number'),
        )
      )?.value ?? '0';

    return Number(value) + 1;
  }

  private async getExchangeRate(
    currency: string,
    date: string,
    toEgp: boolean,
  ) {
    if (currency === 'EGP') return 1;

    const dateRange = getMonthRange(date);

    const from = dateRange?.fromDate?.toDateString();
    const to = dateRange?.toDate?.toDateString();

    const query = toEgp
      ? new GetExchangeRatesQuery('default', currency, 'EGP', from, to)
      : new GetExchangeRatesQuery('default', 'EGP', currency, from, to);

    return (await this.queryBus.execute(query))?.[0]?.rate;
  }

  private buildLines(
    lines: VendorTruckingRawData[],
    header: IVendorTruckingDFOHeader,
    company: string,
    exchangeRate: number,
    reportingRate: number,
    uniqueId: string,
    nextVoucher: () => number,
  ): IVendorTruckingDFOLine[] {
    return lines.map((line) => {
      const dimensionModel = this.parseToDimensions(
        line.ISLEDGER
          ? line.ACCOUNTDISPLAYVALUE
          : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
      );

      return new IVendorTruckingDFOLine({
        header,
        journalBatchNum: header.journalBatchNum,
        lineNumber: line.LINENUMBER,
        accountType: line.ACCOUNTTYPE,
        dimensionModel,
        company,
        credit: line.CREDITAMOUNT ?? 0,
        debit: line.DEBITAMOUNT,
        currency: line.CURRENCYCODE,
        date: line.TRANSDATE,
        description: line.TEXT,
        document: line.DOCUMENT,
        dueDate: line.DUEDATE,
        exchangeRate,
        exchangeRateSecond: 1,
        fineTagDisplayValue: line.FINTAGDISPLAYVALUE,
        invoice: line.INVOICE,
        invoiceDate: line.DOCUMENTDATE,
        isWithHoldingTaxCalculate: line.ISWITHHOLDINGCALCULATIONENABLED,
        itemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
        itemWithholdingTaxGroupCode: '',
        methodOfPayment: line.PAYMENTMETHOD,
        offsetAccountDisplayValue: line.OFFSETACCOUNTDISPLAYVALUE,
        offsetAccountType: line.OFFSETACCOUNTTYPE,
        offsetCompany: company,
        offsetDefaultDimensionDisplayValue:
          line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
        offsetFinTagDisplayValue: line.OFFSETFINTAGDISPLAYVALUE,
        offsetTransactionText: line.OFFSETTEXT,
        overrideSalesTax: line.OVERRIDESALESTAX,
        payMid: Number(uniqueId),
        postingProfile: line.POSTINGPROFILE,
        reportingCurrencyExchange: reportingRate,
        salesTaxGroup: line.SALESTAXGROUP || '',
        taxExemptNumber: '',
        termsOfPayment: '',
        transactionType: 'vendor',
        voucher: nextVoucher(),
        sourceIds: [uniqueId],
      });
    });
  }

  private async loadDimensionsMap() {
    const map: Record<string, IFinancialDimensionValue[]> = {};

    for (const key of this.requiredDimensions) {
      map[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    return map;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}
