import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { EntryProcessorUtilsService } from './entry-processor-utils.service';

import { CashOutExchangeRateService } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { ChartOfAccountsService } from '@/modules/d365fo/services/chart-of-accounts.service';
import { DimensionService } from '@/modules/d365fo/services/dimension.service';
import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { VendorService } from '@/modules/d365fo/services/vendor.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';
import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';
import { PaymentTermService } from '@/modules/master-data/services/payment-term.service';
import { TaxGroupService } from '@/modules/master-data/services/tax-group.service';

@Injectable()
export class EntryProcessorBaseDependencies {
  constructor(
    public readonly queryBus: QueryBus,
    public readonly exchangeRateService: ExchangeRateService,
    public readonly utilsService: EntryProcessorUtilsService,
    public readonly dimensionService: DimensionValidationService,
    public readonly taxGroupService: TaxGroupService,
    public readonly paymentTermService: PaymentTermService,
    public readonly freeTextInvoiceService: FreeTextInvoiceService,
    public readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    public readonly cashOutExchangeRateService: CashOutExchangeRateService,
    public readonly generalJournalService: GeneralJournalService,
    public readonly d365DimensionService: DimensionService,
    public readonly chartOfAccountsService: ChartOfAccountsService,
    public readonly d365VendorService: VendorService,
  ) {}
}
