import { Injectable } from '@nestjs/common';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IEntryProcessor } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountReceivableFreightEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-entry.processor';
import { AccountReceivableFreightCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-credit-note-entry.processor';
import { AccountReceivableTruckingEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-entry.processor';
import { VendorFreightAdjustmentEntryProcessor } from '@/modules/entry-processor/processors/vendor-freight-adjustment-entry.processor';
import { VendorFreightEntryProcessor } from '@/modules/entry-processor/processors/vendor-freight-entry.processor';
import { VendorTruckingAdjustmentEntryProcessor } from '@/modules/entry-processor/processors/vendor-trucking-adjustment-entry.processor';
import { VendorTruckingEntryProcessor } from '@/modules/entry-processor/processors/vendor-trucking-entry.processor';
import { AccountReceivableTruckingCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-credit-note-entry.processor';

@Injectable()
export class EntryProcessorFactory {
  private readonly processors: Map<EntryProcessorTypes, IEntryProcessor> =
    new Map();

  constructor(
    private readonly accountReceivableFreightProcessor: AccountReceivableFreightEntryProcessor,
    private readonly accountReceivableFreightCreditNoteProcessor: AccountReceivableFreightCreditNoteEntryProcessor,
    private readonly accountReceivableTruckingProcessor: AccountReceivableTruckingEntryProcessor,
    private readonly accountReceivableTruckingCreditNoteProcessor: AccountReceivableTruckingCreditNoteEntryProcessor,
    private readonly vendorFreightProcessor: VendorFreightEntryProcessor,
    private readonly vendorTruckingProcessor: VendorTruckingEntryProcessor,
    private readonly vendorFreightAdjustmentProcessor: VendorFreightAdjustmentEntryProcessor,
    private readonly vendorTruckingAdjustmentProcessor: VendorTruckingAdjustmentEntryProcessor,
    // Add other processors here
  ) {
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.processors.set(
      EntryProcessorTypes.AccountReceivableFreight,
      this.accountReceivableFreightProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.AccountReceivableFreightCreditNote,
      this.accountReceivableFreightCreditNoteProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.AccountReceivableTrucking,
      this.accountReceivableTruckingProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.AccountReceivableTruckingCreditNote,
      this.accountReceivableTruckingCreditNoteProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.VendorFreight,
      this.vendorFreightProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.VendorTrucking,
      this.vendorTruckingProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.VendorFreightAdjustment,
      this.vendorFreightAdjustmentProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.VendorTruckingAdjustment,
      this.vendorTruckingAdjustmentProcessor,
    );
    // Register other processors
  }

  public getProcessor(
    entryProcessorType: EntryProcessorTypes,
  ): IEntryProcessor {
    const processor = this.processors.get(entryProcessorType);

    if (!processor) {
      throw new Error(
        `Entry processor not found for type: ${entryProcessorType}`,
      );
    }

    return processor;
  }

  public getProcessorByName(entry: EntryProcessorTypes): IEntryProcessor {
    const processor = this.processors.get(entry);

    if (!processor) {
      throw new Error(`Entry processor ${entry} not found`);
    }

    return processor;
  }

  public getAllProcessors(): IEntryProcessor[] {
    return Array.from(this.processors.values());
  }
}
