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
  CustodySettlementEntryProcessor,
  FreightClosingEntryProcessor,
  TruckingClosingEntryProcessor,
  VendorFreightAdjustmentEntryProcessor,
  VendorFreightEntryProcessor,
  VendorTruckingAdjustmentEntryProcessor,
  VendorTruckingEntryProcessor,
} from '@/modules/entry-processor/processors';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
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
  CustodySettlementEntryProcessor,
  // Add other processors here
];

@Module({
  imports: [CqrsModule, D365FOModule, MasterDataModule, SettingsModule],
  providers: [
    EntryProcessorUtilsService,
    EntryProcessorBaseDependencies,
    EntryProcessorFactory,
    ...EntryProcessors,
  ],
  exports: [EntryProcessorFactory],
})
export class EntryProcessorsModule {}
