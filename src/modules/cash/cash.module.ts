import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import { CashController } from '@/modules/cash/cash.controller';
import {
  ProcessCashInFreightHandler,
  ProcessCashInTruckingHandler,
  ProcessCashInShiplinkHandler,
  ProcessCashInYardHandler,
  ProcessCashOutFreightHandler,
  ProcessCashOutTruckingHandler,
  PostCashBatchToDFOHandler,
} from '@/modules/cash/handlers';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { CashOutTemplateValidationService } from '@/modules/cash/services/cash-out-template-validation.service';
import { VendorPaymentSettlementImportService } from '@/modules/cash/services/vendor-payment-settlement-import.service';
import { YardInvoiceAccountResolver } from '@/modules/cash/yard-invoice/yard-invoice-account.resolver';
import { YardInvoiceEnrichmentService } from '@/modules/cash/yard-invoice/yard-invoice-enrichment.service';
import {
  YardInvoiceJobStore,
  MongoYardInvoiceJobStore,
} from '@/modules/cash/yard-invoice/yard-invoice-job.store';
import { YardInvoicePreviewService } from '@/modules/cash/yard-invoice/yard-invoice-preview.service';
import { YardInvoiceSubmitService } from '@/modules/cash/yard-invoice/yard-invoice-submit.service';
import {
  YardInvoiceReviewLineDoc,
  YardInvoiceReviewLineSchema,
  YardInvoiceUploadJob,
  YardInvoiceUploadJobSchema,
} from '@/modules/cash/yard-invoice/yard-invoice-upload-job.schema';
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
  ProcessCashInShiplinkHandler,
  ProcessCashInYardHandler,
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
    MongooseModule.forFeature([
      { name: YardInvoiceUploadJob.name, schema: YardInvoiceUploadJobSchema },
      {
        name: YardInvoiceReviewLineDoc.name,
        schema: YardInvoiceReviewLineSchema,
      },
    ]),
  ],
  controllers: [CashController],
  providers: [
    CashJournalRoutingService,
    CashOutTemplateValidationService,
    VendorPaymentSettlementImportService,
    YardInvoiceEnrichmentService,
    YardInvoiceAccountResolver,
    YardInvoicePreviewService,
    { provide: YardInvoiceJobStore, useClass: MongoYardInvoiceJobStore },
    YardInvoiceSubmitService,
    ...CommandHandlers,
  ],
})
export class CashModule {}
