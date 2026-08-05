import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashController } from '@/modules/cash/cash.controller';
import {
  ProcessCashInFreightHandler,
  ProcessCashInTruckingHandler,
  ProcessCashOutFreightHandler,
  ProcessCashOutTruckingHandler,
  PostCashBatchToDFOHandler,
} from '@/modules/cash/handlers';
import { CashInSafeTypeRoutingService } from '@/modules/cash/services/cash-in-safetype-routing.service';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { CashOutTemplateValidationService } from '@/modules/cash/services/cash-out-template-validation.service';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QueueModule } from '@/modules/queue/queue.module';

const CommandHandlers = [
  ProcessCashInFreightHandler,
  ProcessCashOutFreightHandler,
  ProcessCashInTruckingHandler,
  ProcessCashOutTruckingHandler,
  PostCashBatchToDFOHandler,
];

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
    QueueModule,
  ],
  controllers: [CashController],
  providers: [
    CashJournalRoutingService,
    CashInSafeTypeRoutingService,
    CashOutTemplateValidationService,
    ...CommandHandlers,
  ],
  exports: [CashInSafeTypeRoutingService, CashJournalRoutingService],
})
export class CashModule {}
