import { Module } from '@nestjs/common';

import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { BillingService } from '@/modules/d365fo/services/billing.service';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import { ExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { ChartOfAccountsService } from '@/modules/d365fo/services/chart-of-accounts.service';

@Module({
  providers: [
    D365FOAuthService,
    D365FOClientService,
    ODataQueryBuilderService,
    BillingService,
    CustomerService,
    CustomerInvoiceService,
    DimensionService,
    ExchangeRateService,
    GeneralJournalService,
    ChartOfAccountsService,
  ],
  exports: [
    D365FOAuthService,
    D365FOClientService,
    ODataQueryBuilderService,
    BillingService,
    CustomerService,
    CustomerInvoiceService,
    DimensionService,
    ExchangeRateService,
    GeneralJournalService,
    ChartOfAccountsService,
  ],
})
export class D365FOModule {}
