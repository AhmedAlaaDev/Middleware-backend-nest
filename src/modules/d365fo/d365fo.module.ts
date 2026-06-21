import { Module } from '@nestjs/common';

import { BillingService } from '@/modules/d365fo/services/billing.service';
import { ChartOfAccountsService } from '@/modules/d365fo/services/chart-of-accounts.service';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import { ExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { FreeTextInvoiceFinTagService } from '@/modules/d365fo/services/free-text-invoice-fin-tag.service';
import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import { LedgerService } from '@/modules/d365fo/services/ledger.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { PaymentTermsService } from '@/modules/d365fo/services/payment-terms.service';
import { TaxItemGroupHeadingService } from '@/modules/d365fo/services/tax-item-group-heading.service';
import { VatNumTableService } from '@/modules/d365fo/services/vat-num-table.service';
import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { VendorPaymentJournalService } from '@/modules/d365fo/services/vendor-payment-journal.service';
import { VendorService } from '@/modules/d365fo/services/vendor.service';

@Module({
  providers: [
    D365FOAuthService,
    D365FOClientService,
    DfoErrorExtractorService,
    ODataQueryBuilderService,
    BillingService,
    CustomerService,
    CustomerInvoiceService,
    DimensionService,
    ExchangeRateService,
    FreeTextInvoiceService,
    FreeTextInvoiceFinTagService,
    GeneralJournalService,
    ChartOfAccountsService,
    VendorService,
    VendorInvoiceJournalService,
    VendorPaymentJournalService,
    CustomerPaymentJournalService,
    PaymentTermsService,
    TaxItemGroupHeadingService,
    LedgerService,
    VatNumTableService,
  ],
  exports: [
    ODataQueryBuilderService,
    BillingService,
    CustomerService,
    CustomerInvoiceService,
    DimensionService,
    ExchangeRateService,
    FreeTextInvoiceService,
    FreeTextInvoiceFinTagService,
    GeneralJournalService,
    ChartOfAccountsService,
    VendorService,
    VendorInvoiceJournalService,
    VendorPaymentJournalService,
    CustomerPaymentJournalService,
    PaymentTermsService,
    TaxItemGroupHeadingService,
    LedgerService,
    VatNumTableService,
  ],
})
export class D365FOModule {}
