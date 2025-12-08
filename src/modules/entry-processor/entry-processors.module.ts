import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { AccountReceivableFreightEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-entry.processor';
import { AccountReceivableFreightCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-credit-note-entry.processor';
import { AccountReceivableTruckingEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-entry.processor';
import { AccountReceivableTruckingCreditNoteEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-credit-note-entry.processor';
import { VendorFreightEntryProcessor } from '@/modules/entry-processor/processors/vendor-freight-entry.processor';
import { VendorTruckingEntryProcessor } from '@/modules/entry-processor/processors/vendor-trucking-entry.processor';
import { MasterDataModule } from '@/modules/master-data/master-data.module';

const EntryProcessors = [
  AccountReceivableFreightEntryProcessor,
  AccountReceivableFreightCreditNoteEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
  AccountReceivableTruckingCreditNoteEntryProcessor,
  VendorFreightEntryProcessor,
  VendorTruckingEntryProcessor,
  // Add other processors here
];

@Module({
  imports: [CqrsModule, D365FOModule, MasterDataModule],
  providers: [EntryProcessorFactory, ...EntryProcessors],
  exports: [EntryProcessorFactory],
})
export class EntryProcessorsModule {}
