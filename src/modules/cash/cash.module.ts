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
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { CashOutTemplateValidationService } from '@/modules/cash/services/cash-out-template-validation.service';
import { VendorPaymentSettlementImportService } from '@/modules/cash/services/vendor-payment-settlement-import.service';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
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
    D365FOModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
    QueueModule,
  ],
  controllers: [CashController],
  providers: [
    CashJournalRoutingService,
    CashOutTemplateValidationService,
    VendorPaymentSettlementImportService,
    ...CommandHandlers,
  ],
})
export class CashModule {}
