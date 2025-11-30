import { Module } from '@nestjs/common';
import { EntryProcessorFactory } from './services/entry-processor.factory';
import { AccountReceivableFreightEntryProcessor } from './processors/account-receivable-freight-entry.processor';
import { AccountReceivableTruckingEntryProcessor } from './processors/account-receivable-trucking-entry.processor';
import { D365FOModule } from '../d365fo/d365fo.module';
import { MasterDataModule } from '../master-data/master-data.module';

const EntryProcessors = [
  AccountReceivableFreightEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
  // Add other processors here
];

@Module({
  imports: [D365FOModule, MasterDataModule],
  providers: [EntryProcessorFactory, ...EntryProcessors],
  exports: [EntryProcessorFactory],
})
export class EntryProcessorsModule {}

