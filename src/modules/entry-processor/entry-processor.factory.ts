import { Injectable } from '@nestjs/common';

import {
  AccountReceivableFreightEntryProcessor,
  AccountReceivableFreightCreditNoteEntryProcessor,
  AccountReceivableTruckingCreditNoteEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
} from '@/modules/accounts-receivable/processors';
import {
  CashInFreightEntryProcessor,
  CashOutFreightEntryProcessor,
} from '@/modules/cash/processors';
import {
  ClosingCustodySettlementEntryProcessor,
  ClosingFreightDifferenceEntryProcessor,
  ClosingFreightEntryProcessor,
  ClosingTruckingEntryProcessor,
} from '@/modules/closing/processors';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IEntryProcessor } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import {
  VendorFreightEntryProcessor,
  VendorPaymentFreightEntryProcessor,
  VendorPaymentTruckingEntryProcessor,
  VendorTruckingEntryProcessor,
} from '@/modules/vendor/processors';

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
    private readonly vendorPaymentFreightProcessor: VendorPaymentFreightEntryProcessor,
    private readonly vendorPaymentTruckingProcessor: VendorPaymentTruckingEntryProcessor,

    private readonly cashInFreightProcessor: CashInFreightEntryProcessor,
    private readonly cashOutFreightProcessor: CashOutFreightEntryProcessor,

    private readonly closingFreightProcessor: ClosingFreightEntryProcessor,
    private readonly closingFreightDifferenceProcessor: ClosingFreightDifferenceEntryProcessor,
    private readonly closingTruckingProcessor: ClosingTruckingEntryProcessor,
    private readonly closingCustodySettlementProcessor: ClosingCustodySettlementEntryProcessor,
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
      EntryProcessorTypes.VendorPaymentFreight,
      this.vendorPaymentFreightProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.VendorPaymentTrucking,
      this.vendorPaymentTruckingProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.LedgerFreightClosingEntry,
      this.closingFreightProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.LedgerClosingFreightDifference,
      this.closingFreightDifferenceProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.LedgerTruckingClosingEntry,
      this.closingTruckingProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.LedgerCustodySettlementEntry,
      this.closingCustodySettlementProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.CashInFreight,
      this.cashInFreightProcessor,
    );
    this.processors.set(
      EntryProcessorTypes.CashOutFreight,
      this.cashOutFreightProcessor,
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
