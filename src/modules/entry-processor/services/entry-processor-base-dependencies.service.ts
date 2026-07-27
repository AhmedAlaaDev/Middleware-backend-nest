import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { EntryProcessorUtilsService } from './entry-processor-utils.service';

import { CashOutExchangeRateService } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';
import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';
import { TaxGroupService } from '@/modules/master-data/services/tax-group.service';

@Injectable()
export class EntryProcessorBaseDependencies {
  constructor(
    public readonly queryBus: QueryBus,
    public readonly exchangeRateService: ExchangeRateService,
    public readonly utilsService: EntryProcessorUtilsService,
    public readonly dimensionService: DimensionValidationService,
    public readonly taxGroupService: TaxGroupService,
    public readonly freeTextInvoiceService: FreeTextInvoiceService,
    public readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    public readonly cashOutExchangeRateService: CashOutExchangeRateService,
  ) {}
}
