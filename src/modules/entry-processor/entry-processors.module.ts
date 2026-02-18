import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

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
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import {
  EntryProcessorBaseDependencies,
  EntryProcessorUtilsService,
} from '@/modules/entry-processor/services';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import {
  VendorFreightEntryProcessor,
  VendorTruckingEntryProcessor,
} from '@/modules/vendor/processors';

const EntryProcessors = [
  AccountReceivableFreightEntryProcessor,
  AccountReceivableFreightCreditNoteEntryProcessor,
  AccountReceivableTruckingEntryProcessor,
  AccountReceivableTruckingCreditNoteEntryProcessor,
  VendorFreightEntryProcessor,
  VendorTruckingEntryProcessor,
  CashInFreightEntryProcessor,
  CashOutFreightEntryProcessor,
  ClosingFreightEntryProcessor,
  ClosingFreightDifferenceEntryProcessor,
  ClosingTruckingEntryProcessor,
  ClosingCustodySettlementEntryProcessor,
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
