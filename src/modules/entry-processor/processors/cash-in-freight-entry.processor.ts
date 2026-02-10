import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { getMonthKey } from '@/lib/utils';
import { CashInFreightDFOLine } from '@/modules/cash-in/interfaces/cash-in-freight-dfo-data.interface';
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
import { GetCustomersQuery } from '@/modules/master-data/queries';
import { GetSettingQuery } from '@/modules/settings/queries/get-setting.query';

type RawDataInvoiceMap = Map<string, CashInFreightRawData[]>;

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(CashInFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

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
    const sortedLines = this.sortLinesByLineNumber(this.mapToModels(data));

    // STEP 2: Build invoice map
    const invoiceMap = this.buildInvoiceMap(sortedLines);
    const invoiceCount = invoiceMap.size;
    this.procLogger.debug(
      `Grouped ${sortedLines.length} lines into ${invoiceCount} invoices`,
    );

    // STEP 3: Batch processing (rules)
    // - MAX 1000 lines per batch
    // - batch contains only invoices from the same month
    // - invoice cannot be split across batches
    const journalBatchNum = await this.getNextBatchNumber();
    const voucherNum = await this.getNextVoucherNumber();
    const updatedInvoiceMap = this.updateBatchAndVoucher(
      invoiceMap,
      journalBatchNum,
      voucherNum,
    );

    // STEP 4: Build DFO lines
    const dfoLines = await this.buildLine(updatedInvoiceMap, company);

    return dfoLines;
  }

  // --------------------------------------------------------------------------
  // VALIDATE
  // --------------------------------------------------------------------------

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as CashInFreightDFOLine[];

    const dimensionsMap = await this.getDimensionsMap();

    for (const line of lines) {
      this.validateActivityName(line, dimensionsMap.get('Activity')!);
      this.validateCostCenter(line, dimensionsMap.get('CostCenters')!);
      this.validateBusinessUnit(line, dimensionsMap.get('BusinessUnit')!);
      this.validateLocation(line, dimensionsMap.get('Location')!);
      this.validateSalesMan(line, dimensionsMap.get('SalesMan')!);
      this.validateFreightType(line, dimensionsMap.get('FreightType')!);
      this.validateCoordinatorMan(line, dimensionsMap.get('CoordinatorMan')!);
      this.validateDirection(line, dimensionsMap.get('Direction')!);
      this.validateCustomerDimension(line, dimensionsMap.get('Customer')!);

      if (line.DimensionModel.subCustomer) {
        this.validateSubCustomerDimension(
          line,
          dimensionsMap.get('SubCustomer')!,
        );
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

  private mapToModels(data: RawDataModel[]): CashInFreightRawData[] {
    return data.map((d) => new CashInFreightRawData(d));
  }

  private sortLinesByLineNumber(
    lines: CashInFreightRawData[],
  ): CashInFreightRawData[] {
    return [...lines].sort((a, b) => a.LINENUMBER - b.LINENUMBER);
  }

  private updateBatchAndVoucher(
    invoiceMap: RawDataInvoiceMap,
    journalBatchNum: number,
    voucherNum: number,
  ): RawDataInvoiceMap {
    const updatedMap: RawDataInvoiceMap = new Map();

    let currentBatchMonth: string | null = null;
    let currentBatchLineCount = 0;
    let currentBatchNumber = journalBatchNum;
    let currentVoucherNum = voucherNum;

    let lineNumberInBatch = 1;

    for (const [uniqueId, lines] of invoiceMap.entries()) {
      if (!lines || lines.length === 0) {
        continue;
      }

      const headerLine = lines[0];
      const invoiceMonth = getMonthKey(headerLine.TRANSDATE);

      const invoiceLineCount = lines.length;
      const monthChanged = currentBatchMonth !== invoiceMonth;
      const wouldExceedLimit =
        currentBatchLineCount + invoiceLineCount > this.MAX_LINES_PER_BATCH;

      // If month changes, or adding this invoice would exceed the max lines,
      // we start a new batch and reset line number.
      if (monthChanged || wouldExceedLimit) {
        if (currentBatchMonth !== null) {
          currentBatchNumber++;
        }
        currentBatchMonth = invoiceMonth;
        currentBatchLineCount = 0;
        lineNumberInBatch = 1;
      }

      // Edge case: a single invoice exceeds the batch limit.
      // We keep it intact (do not split invoice), even if it exceeds 1000.
      if (invoiceLineCount > this.MAX_LINES_PER_BATCH) {
        this.procLogger.warn(
          `Invoice ${headerLine.INVOICE ?? headerLine.UniqueId} has ${invoiceLineCount} lines (> ${this.MAX_LINES_PER_BATCH}). Keeping it in a single batch.`,
        );
      }

      const journalName = headerLine.JOURNALNAME;
      const formattedBatch = this.formatBatchNumber(currentBatchNumber);
      const formattedVoucher = this.formatVoucherNumber(
        currentVoucherNum,
        journalName,
      );

      const updatedLines: CashInFreightRawData[] = [];

      for (const line of lines) {
        const updatedLine = new CashInFreightRawData({
          ...line,
          JOURNALBATCHNUMBER: formattedBatch,
          VOUCHER: formattedVoucher,
          LINENUMBER: lineNumberInBatch,
        });

        updatedLines.push(updatedLine);
        currentBatchLineCount++;
        lineNumberInBatch++;
      }

      // Move to next voucher for the next invoice
      currentVoucherNum++;

      updatedMap.set(uniqueId, updatedLines);
    }

    return updatedMap;
  }

  private buildInvoiceMap(
    sortedLines: CashInFreightRawData[],
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

  private async buildLine(
    _invoiceMap: RawDataInvoiceMap,
    _company: string,
  ): Promise<CashInFreightDFOLine[]> {
    const dfoLines: CashInFreightDFOLine[] = [];
    return Promise.resolve(dfoLines);
  }

  private async getCustomerName(
    accountType: string,
    accountDisplayValue: string,
    company: string,
  ): Promise<string> {
    if (accountType.toLowerCase() !== 'cust') return '';

    const customers = await this.queryBus.execute(
      new GetCustomersQuery({
        company: company,
        searchTerm: accountDisplayValue,
      }),
    );

    return customers?.items[0]?.name || '';
  }

  private async getMainAccounts(): Promise<{ accountNumber: string }[]> {
    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );
    return mainAccounts;
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

  private async getDimensionsMap() {
    const dimensionsMap = new Map<string, IFinancialDimensionValue[]>();
    for (const key of this.requiredDimensions) {
      const dimensionValues = await this.getFinancialDimensionValues(key);
      dimensionsMap.set(key, dimensionValues || []);
    }
    return dimensionsMap;
  }
}
