import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CashEntryDynDataModel } from '@/modules/cash/cash-in/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/cash-in/models/cash-entry-raw-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/models/entry-processor.model';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types/dimension-key.type';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';

type RawDataInvoiceMap = Map<string, CashEntryRawDataModel[]>;

@Injectable()
export class CashInFreightEntryProcessor extends EntryProcessorBase {
  private readonly logger = new Logger(CashInFreightEntryProcessor.name);

  // --------------------------------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------------------------------

  readonly entryProcessorType = EntryProcessorTypes.CashInFreight;
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    Customer: true,
    SubCustomer: false,
    ChargeType: true,
    SalesMan: true,
    CoordinatorMan: true,
    FreightType: true,
    Direction: true,
  };

  constructor(
    private readonly commandBus: CommandBus,
    baseDeps: EntryProcessorBaseDependencies,
  ) {
    super({ dependencies: baseDeps });
  }

  // --------------------------------------------------------------------------
  // FORMAT & ENRICH
  // --------------------------------------------------------------------------

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    this.company = company;

    await this.warmupProcessorData({ customerNames: true });

    const rawCount = data.length;
    this.logger.debug(
      `Starting formatAndEnrichAsync with ${rawCount} raw records`,
    );

    // STEP 1: Map & sort
    this.logger.debug(`[STEP 1] Mapping ${rawCount} raw records to models`);
    const rawLines = this.mapToModel(data);
    this.logger.debug(`[STEP 1] Mapped to ${rawLines.length} lines`);

    // STEP 1.5: Sort lines by line number
    this.logger.debug(
      `[STEP 1.5] Sorting ${rawLines.length} lines by line number`,
    );
    const sortedLines = this.sortRawDataByLineNumber(rawLines);
    this.logger.debug(`[STEP 1.5] Sorted to ${sortedLines.length} lines`);

    // STEP 2: FILTER CUSTODY SETTLEMENTS
    this.logger.debug(
      `[STEP 2] Filtering custody settlements from ${sortedLines.length} lines`,
    );
    const { custodySettlementLines, otherLines } =
      this.filterLines(sortedLines);
    this.logger.debug(
      `[FILTER] Processed ${sortedLines.length} lines → ${custodySettlementLines.length} custody settlement, ${otherLines.length} customer collection, down payment and other lines`,
    );

    // STEP 2.5: run custody settlement with raw data (no file – already extracted from Excel)
    this.logger.debug(
      `[STEP 2.5] Processing ${custodySettlementLines.length} custody settlement lines`,
    );
    this.processCustodySettlementLines(custodySettlementLines, company);

    // STEP 3: Build invoice map
    this.logger.debug(
      `[STEP 3] Building invoice map from ${otherLines.length} lines`,
    );
    const invoiceMap = this.buildUniqueIdMap(otherLines);
    const invoiceCount = invoiceMap.size;
    this.logger.debug(`[STEP 3] Grouped into ${invoiceCount} invoices`);

    // STEP 4: Build DFO lines
    this.logger.debug(
      `[STEP 4] Building DFO lines from ${invoiceCount} invoices`,
    );
    const dfoLines = this.buildLines(invoiceMap, company);
    this.logger.debug(`[STEP 4] Built ${dfoLines.length} DFO lines`);

    // STEP 5: Update batch and voucher numbers
    this.logger.debug(
      `[STEP 5] Updating batch and voucher numbers for ${dfoLines.length} lines`,
    );
    const updatedDfoLines = this.utilsService.updateBatchAndVoucher({
      lines: dfoLines,
      startBatchNumber: 1,
      startVoucherNumber: 1,
      maxLinesPerBatch: this.MAX_LINES_PER_BATCH,
    });
    this.logger.debug(
      `[STEP 5] Updated batch and voucher numbers for ${updatedDfoLines.length} lines`,
    );

    return updatedDfoLines;
  }

  public validateAsync(data: DynDataModel[], _company: string): DynDataModel[] {
    const lines = data as unknown as CashEntryDynDataModel[];
    const lineCount = lines.length;
    this.logger.debug(`[VALIDATE] Starting validation for ${lineCount} lines`);

    for (const line of lines) {
      this.validateDimensionsForLine(line, {
        validateMainAccount:
          line.AccountType?.trim()?.toLowerCase() === 'ledger',
      });
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapToModel(data: RawDataModel[]): CashEntryRawDataModel[] {
    return data.map((d) => new CashEntryRawDataModel(d, 'Freight'));
  }

  private filterLines(sortedLines: CashEntryRawDataModel[]) {
    const custodySettlementLines: CashEntryRawDataModel[] = [];
    const otherLines: CashEntryRawDataModel[] = [];

    for (const line of sortedLines) {
      if (line.IsCustodySettlement) {
        custodySettlementLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    return {
      custodySettlementLines,
      otherLines,
    };
  }

  private processCustodySettlementLines(
    lines: CashEntryRawDataModel[],
    company: string,
  ): void {
    if (lines.length === 0) return;

    const command = new ProcessCustodySettlementEntryCommand(
      company,
      undefined,
      lines,
    );

    this.commandBus
      .execute(command)
      .then(() => {
        this.logger.debug(
          `[STEP 2.5] Successfully processed ${lines.length} custody settlement lines`,
        );
      })
      .catch((error) => {
        this.logger.error(
          `[STEP 2.5] Error processing custody settlement entry for ${lines.length} lines: ${error}`,
        );
      });
  }

  private buildLines(
    _invoiceMap: RawDataInvoiceMap,
    _company: string,
  ): CashEntryDynDataModel[] {
    const dfoLines: CashEntryDynDataModel[] = [];

    return dfoLines;
  }
}
