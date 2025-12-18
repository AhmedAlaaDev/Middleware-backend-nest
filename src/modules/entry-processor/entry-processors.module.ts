import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import {
  AccountReceivableFreightCreditNoteEntryProcessor,
  AccountReceivableFreightEntryProcessor,
  AccountReceivableTruckingCreditNoteEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
  CashInFreightEntryProcessor,
  CashOutFreightEntryProcessor,
  FreightClosingEntryProcessor,
  TruckingClosingEntryProcessor,
  VendorFreightAdjustmentEntryProcessor,
  VendorFreightEntryProcessor,
  VendorTruckingAdjustmentEntryProcessor,
  VendorTruckingEntryProcessor,
} from '@/modules/entry-processor/processors';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { SettingsModule } from '@/modules/settings/settings.module';

const EntryProcessors = [
  AccountReceivableFreightEntryProcessor,
  AccountReceivableFreightCreditNoteEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
  AccountReceivableTruckingCreditNoteEntryProcessor,
  VendorFreightEntryProcessor,
  VendorFreightAdjustmentEntryProcessor,
  VendorTruckingEntryProcessor,
  VendorTruckingAdjustmentEntryProcessor,
  CashInFreightEntryProcessor,
  CashOutFreightEntryProcessor,
  FreightClosingEntryProcessor,
  TruckingClosingEntryProcessor,
  // Add other processors here
];

@Module({
  imports: [CqrsModule, D365FOModule, MasterDataModule, SettingsModule],
  providers: [EntryProcessorFactory, ...EntryProcessors],
  exports: [EntryProcessorFactory],
})
export class EntryProcessorsModule {}
