import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { AccountReceivableFreightCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-credit-note-entry.processor';
import { AccountReceivableFreightEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-entry.processor';
import { AccountReceivableTruckingCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-credit-note-entry.processor';
import { AccountReceivableTruckingEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-entry.processor';
import { VendorFreightAdjustmentEntryProcessor } from '@/modules/entry-processor/processors/vendor-freight-adjustment-entry.processor';
import { VendorFreightEntryProcessor } from '@/modules/entry-processor/processors/vendor-freight-entry.processor';
import { VendorTruckingAdjustmentEntryProcessor } from '@/modules/entry-processor/processors/vendor-trucking-adjustment-entry.processor';
import { VendorTruckingEntryProcessor } from '@/modules/entry-processor/processors/vendor-trucking-entry.processor';
import { TruckingClosingEntryProcessor } from '@/modules/entry-processor/processors/trucking-closing-entry.processor';
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
  TruckingClosingEntryProcessor,
  // Add other processors here
];

@Module({
  imports: [CqrsModule, D365FOModule, MasterDataModule, SettingsModule],
  providers: [EntryProcessorFactory, ...EntryProcessors],
  exports: [EntryProcessorFactory],
})
export class EntryProcessorsModule {}
