import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

const SETTLEMENT_ENDPOINT = '/data/PaymentJournalLineSettledInvoices';

export interface CustomerPaymentJournalSettlementTarget {
  lineNumber: number;
  invoiceNumber: string;
  settlementAmount: number;
}

export interface CustomerPaymentJournalSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  SettlementAmountInInvoiceCurrency: number;
}

interface ExistingSettlementRow {
  JournalLineCompany?: string;
  JournalBatchNumber?: string;
  JournalLineNumber?: string | number;
  InvoiceNumber?: string;
  InvoiceCompany?: string;
  SettlementAmountInInvoiceCurrency?: string | number;
}

@Injectable()
export class CustomerPaymentJournalSettlementService {
  private readonly logger = new Logger(
    CustomerPaymentJournalSettlementService.name,
  );

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  public async createSettlements(options: {
    company: string;
    journalBatchNumber: string;
    targets: CustomerPaymentJournalSettlementTarget[];
  }): Promise<void> {
    const company = String(options.company ?? '').trim();
    const journalBatchNumber = String(options.journalBatchNumber ?? '').trim();
    if (!company || !journalBatchNumber || options.targets.length === 0) {
      return;
    }

    for (const target of options.targets) {
      await this.createSettlement(company, journalBatchNumber, target);
    }
  }

  private async createSettlement(
    company: string,
    journalBatchNumber: string,
    target: CustomerPaymentJournalSettlementTarget,
  ): Promise<void> {
    const invoiceNumber = String(target.invoiceNumber ?? '').trim();
    const lineNumber = Number(target.lineNumber);
    const settlementAmount = Number(target.settlementAmount ?? 0);
    if (!invoiceNumber || !(lineNumber > 0) || !(settlementAmount > 0)) {
      throw new Error(
        `Customer settlement for journal ${journalBatchNumber} line ${target.lineNumber} is missing invoice, line number, or amount.`,
      );
    }

    if (
      await this.settlementExists(
        company,
        journalBatchNumber,
        lineNumber,
        invoiceNumber,
      )
    ) {
      this.logger.log(
        `Skipping existing customer settlement for ${journalBatchNumber} line ${lineNumber} invoice ${invoiceNumber}`,
      );
      return;
    }

    const payload: CustomerPaymentJournalSettlementPayload = {
      JournalLineCompany: company,
      JournalBatchNumber: journalBatchNumber,
      JournalLineNumber: lineNumber,
      InvoiceNumber: invoiceNumber,
      InvoiceCompany: company,
      SettlementAmountInInvoiceCurrency: settlementAmount,
    };

    await this.d365.post<
      CustomerPaymentJournalSettlementPayload,
      ExistingSettlementRow
    >(SETTLEMENT_ENDPOINT, payload, { retries: 0 });
  }

  private async settlementExists(
    company: string,
    journalBatchNumber: string,
    lineNumber: number,
    invoiceNumber: string,
  ): Promise<boolean> {
    const endpoint = this.query.buildQuery(SETTLEMENT_ENDPOINT, {
      filter: this.query.and(
        this.query.eq('JournalLineCompany', company),
        this.query.eq('JournalBatchNumber', journalBatchNumber),
        this.query.eq('JournalLineNumber', lineNumber),
        this.query.eq('InvoiceNumber', invoiceNumber),
      ),
      top: 1,
      crossCompany: true,
    });
    const response = await this.d365.get<ExistingSettlementRow>(endpoint, {
      useCache: false,
    });
    return (response.value ?? []).length > 0;
  }
}
