import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashInEntryProcessor } from '../cash-in-entry.processor';
import { CashInDirectLineBuilder } from './cash-in-direct-line.builder';

import { assignCashMissingUniqueIds } from '@/modules/cash/policies/cash-batch.policy';
import { mapCashRawData } from '@/modules/cash/policies/cash-normalization.policy';
import { CashProductLine } from '@/modules/cash/types';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';

/**
 * Shared Cash-In path for Shiplink and Yard.
 *
 * The source workbook already carries customer and offset on the same row.
 * This processor keeps Cash-In Excel format and dimension validation. It
 * skips Freight/Fleet pairing, invoice rewrite, and exclusive MarkedLines.
 * Each journal line later settles its own credit against the Excel invoice
 * through PaymentJournalLineSettledInvoices.
 */
@Injectable()
export abstract class CashInDirectEntryProcessor extends CashInEntryProcessor {
  protected constructor(
    commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super(commandBus, baseDeps);
  }

  protected isTrucking(): boolean {
    return false;
  }

  protected abstract getDirectProduct(): CashProductLine;

  public async formatAndEnrichAsync(
    data: EntryRawDataModel[],
    company: string,
  ): Promise<EntryDynDataModel[]> {
    this.company = company;

    await this.warmupProcessorData({
      exchangeRates: true,
      customerNames: true,
    });

    const rawLines = mapCashRawData(data, this.getDirectProduct(), true);
    assignCashMissingUniqueIds(rawLines);
    rawLines.forEach((line, index) => {
      if (!line.LINENUMBER) {
        line.LINENUMBER = index + 1;
      }
    });

    const builder = new CashInDirectLineBuilder({
      company: this.company,
      parseDimensionString: (displayValue) =>
        this.utilsService.parseDimensionString(displayValue),
      getDimensionSegmentLength: (displayValue) =>
        this.utilsService.getDimensionSegmentLength(displayValue),
      isValidDimensionSegmentLength: (segmentLength) =>
        this.utilsService.isValidDimensionSegmentLength(segmentLength),
      fetchExchangeRates: (transactionDate, currencyCode) =>
        this.fetchExchangeRates(transactionDate, currencyCode),
      getCustomerName: (customerAccount) =>
        this.getCustomerName(customerAccount),
    });

    const dfoLines = rawLines.map((line) => builder.build(line));

    return this.utilsService.updateCashBatchAndVoucher({
      lines: dfoLines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
      maxLinesPerBatch: this.MAX_LINES_PER_BATCH,
    });
  }
}
