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
  IVendorFreightDFOHeader,
  IVendorFreightDFOLine,
} from '@/modules/vendor/interfaces/vendor-freight-dfo-data.interface';
import { VendorFreightRawData } from '@/modules/vendor/models/vendor-freight-raw-data.model';

@Injectable()
export class VendorFreightEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType = EntryProcessorTypes.VendorFreight;
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
    const raw = data?.map((d) => {
      return new VendorFreightRawData(d);
    });

    const sorted = raw.sort((a, b) => {
      return a.UniqueId - b.UniqueId;
    });

    const groupedByUniqueId = new Map<string, VendorFreightRawData[]>();

    for (const line of sorted) {
      const uniqueId = line.UniqueId.toString();
      if (!groupedByUniqueId.has(uniqueId)) {
        groupedByUniqueId.set(uniqueId, []);
      }
      groupedByUniqueId.get(uniqueId)!.push(line);
    }

    const eData: IVendorFreightDFOLine[] = [];

    const currentBatchNum =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.batch.number'),
        )
      )?.value ?? '0';
    let journalBatchNum: number = Number(currentBatchNum) + 1;
    const currentVoucherNum =
      (
        await this.queryBus.execute(
          new GetSettingQuery('last.ledger.vendor.freight.voucher.number'),
        )
      )?.value ?? '0';
    let voucherNum: number = Number(currentVoucherNum) + 1;

    for (const [uniqueId, lines] of groupedByUniqueId.entries()) {
      const header = lines[0];
      const formattedDate = formatToMonthYear(header.TRANSDATE);
      const { fromDate, toDate } = getMonthRange(header.TRANSDATE);

      const exchangeRate =
        header.CURRENCYCODE === 'EGP'
          ? 1
          : (
              await this.queryBus.execute(
                new GetExchangeRatesQuery(
                  'default',
                  header.CURRENCYCODE,
                  'EGP',
                  fromDate?.toDateString(),
                  toDate?.toDateString(),
                ),
              )
            )?.[0]?.rate;

      const reportingCurrencyExchange =
        header.CURRENCYCODE === 'EGP'
          ? 1
          : (
              await this.queryBus.execute(
                new GetExchangeRatesQuery(
                  'default',
                  'EGP',
                  header.CURRENCYCODE,
                  fromDate?.toDateString(),
                  toDate?.toDateString(),
                ),
              )
            )?.[0]?.rate;

      let journalTotalCredit = 0;
      let journalTotalDebit = 0;

      const dfoHeader = new IVendorFreightDFOHeader({
        journalBatchNum,
        description: `Vendor Invoice Freight ${formattedDate}`,
        isPosted: header.ISPOSTED,
        journalName: header.JOURNALNAME,
        journalTotalCredit,
        journalTotalDebit,
        oversideSalesTax: false,
        salesTaxIncluded: true,
      });

      const linesData: IVendorFreightDFOLine[] = lines.map((line) => {
        journalTotalCredit += line.CREDITAMOUNT ?? 0;
        journalTotalDebit += line.DEBITAMOUNT ?? 0;

        const dimensionModel = this.parseToDimensions(
          line.ISLEDGER
            ? line.ACCOUNTDISPLAYVALUE
            : line.DEFAULTDIMENSIONDISPLAYVALUE || '',
        );

        voucherNum++;

        return new IVendorFreightDFOLine({
          header: dfoHeader,
          journalBatchNum,
          lineNumber: line.LINENUMBER,
          accountType: line.ACCOUNTTYPE,
          dimensionModel,
          company: company,
          credit: line.CREDITAMOUNT ?? 0,
          currency: line.CURRENCYCODE,
          date: line.TRANSDATE,
          debit: line.DEBITAMOUNT,
          description: line.TEXT,
          document: line.DOCUMENT,
          dueDate: line.DUEDATE,
          exchangeRate: exchangeRate,
          exchangeRateSecond: 1,
          fineTagDisplayValue: line.FINTAGDISPLAYVALUE,
          invoice: line.INVOICE,
          invoiceDate: line.DOCUMENTDATE,
          isWithHoldingTaxCalculate: line.ISWITHHOLDINGCALCULATIONENABLED,
          itemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
          itemWithholdingTaxGroupCode: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
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
          reportingCurrencyExchange: reportingCurrencyExchange,
          salesTaxGroup: line.SALESTAXGROUP || '',
          taxExemptNumber: '',
          termsOfPayment: '',
          transactionType: 'vendor',
          voucher: voucherNum,
          sourceIds: [uniqueId],
        });
      });

      eData.push(...linesData);
      journalBatchNum++;
    }

    return eData as unknown as DynDataModel[];
  }

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const arData = data as unknown as IVendorFreightDFOLine[];

    // Load dimensions and accounts
    const accounts = await this.getAllMainAccounts();
    const accountNumbers = accounts.map(({ accountNumber }) => ({
      accountNumber,
    }));

    type MapKey = (typeof this.requiredDimensions)[number];

    const dimensionsMap = new Map<MapKey, IFinancialDimensionValue[]>();

    for (const dimensionKey of this.requiredDimensions) {
      const dimensionValues =
        await this.getFinancialDimensionValues(dimensionKey);
      dimensionsMap.set(dimensionKey, dimensionValues || []);
    }

    // Validate each line
    for (const arLine of arData) {
      // Validate main account
      this.validateMainAccount(arLine, accountNumbers);
      // Validate activity
      this.validateActivityName(arLine, dimensionsMap.get('Activity') || []);
      // Validate cost centers
      this.validateCostCenter(arLine, dimensionsMap.get('CostCenters') || []);
      // Validate business unit
      this.validateBusinessUnit(
        arLine,
        dimensionsMap.get('BusinessUnit') || [],
      );
      // Validate location
      this.validateLocation(arLine, dimensionsMap.get('Location') || []);
      // Validate charge type
      // Validate sales man
      this.validateSalesMan(arLine, dimensionsMap.get('SalesMan') || []);
      // Validate freight type
      this.validateFreightType(arLine, dimensionsMap.get('FreightType') || []);
      // Validate coordinator man
      this.validateCoordinatorMan(
        arLine,
        dimensionsMap.get('CoordinatorMan') || [],
      );
      // Validate direction
      this.validateDirection(arLine, dimensionsMap.get('Direction') || []);
      // Validate vendor
      this.validateVendor(arLine, dimensionsMap.get('Vendor') || []);
      // validate subvendor
      if (arLine.dimensionModel.subVendor) {
        this.validateSubVendor(arLine, dimensionsMap.get('SubVendor') || []);
      }
    }

    return data;
  }

  public async insertIntoDynamicsAsync(
    _data: DynDataModel[],
    _company: string,
  ): Promise<void> {}
}
