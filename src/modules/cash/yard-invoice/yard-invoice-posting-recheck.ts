import { Injectable } from '@nestjs/common';

import {
  offsetRequestKey,
  YardInvoiceAccountResolver,
  YardOffsetAccountResolution,
} from './yard-invoice-account.resolver';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { YardInvoiceEnrichmentService } from './yard-invoice-enrichment.service';
import { YardInvoiceLookupResult } from './yard-invoice-lookup.types';
import { YARD_INVOICE_BALANCE_TOLERANCE_MAJOR } from './yard-invoice.constants';
import { sameDisplayValue } from './yard-invoice-validation';

/** One batch row as it was uploaded, read back before posting. */
export interface YardBatchRowSnapshot {
  invoiceNumber: string;
  customerAccount: string;
  defaultDimension: string;
  financialTag: string;
  offsetAccount: string;
  paymentType: string;
  paymentDate: string;
  currencyCode: string;
  amount: number;
}

/**
 * Reads one stored enhanced record back into a batch row. Stored records use the
 * CashEntryDynDataModel property names (PascalCase), so the reader uses those.
 * The invoice is Invoice, then MarkedInvoice, then the "Yard receipt <invoice>"
 * description.
 */
export function yardBatchRowFromStoredRecord(data: Record<string, unknown>): {
  lineNumber: number | undefined;
  row: YardBatchRowSnapshot;
} {
  const text = (key: string): string => String(data[key] ?? '').trim();
  const invoiceNumber =
    text('Invoice') ||
    text('MarkedInvoice') ||
    text('Description').replace(/^Yard receipt /, '').trim();
  const lineNumber = Number(data.LineNumber);
  return {
    lineNumber: lineNumber > 0 ? lineNumber : undefined,
    row: {
      invoiceNumber,
      customerAccount: text('AccountDisplayValue'),
      defaultDimension: text('DefaultDimensionsForAccountDisplayValue'),
      financialTag: text('FinTagDisplayValue'),
      offsetAccount: text('OffsetAccountDisplayValue'),
      paymentType: text('VoucherType'),
      paymentDate: text('TransactionDate') || text('TransDate'),
      currencyCode: text('CurrencyCode'),
      amount: Number(data.CreditAmount ?? 0),
    },
  };
}

/**
 * Compares one uploaded batch row with the live D365 values for its invoice. The
 * same rules as the review: the customer, the default dimension, the financial
 * tag, the offset account and the open balance must still agree.
 */
export function compareYardBatchRowToD365(
  row: YardBatchRowSnapshot,
  lookup: YardInvoiceLookupResult | undefined,
  offset: YardOffsetAccountResolution | undefined,
): string[] {
  const invoice = row.invoiceNumber;
  if (!lookup || lookup.status !== 'FOUND') {
    return [
      `${invoice}: D365 lookup no longer resolves (${lookup?.status ?? 'missing'})`,
    ];
  }
  const metadata = lookup.metadata;
  const problems: string[] = [];
  if (metadata.customerAccount.trim() !== row.customerAccount.trim()) {
    problems.push(
      `${invoice}: customer changed from ${row.customerAccount} to ${metadata.customerAccount}`,
    );
  }
  if (
    !sameDisplayValue(
      'default dimensions',
      row.defaultDimension,
      metadata.defaultDimensionDisplayValue,
    )
  ) {
    problems.push(`${invoice}: default dimension changed in D365`);
  }
  if (
    !sameDisplayValue(
      'financial tag',
      row.financialTag,
      metadata.financialTagDisplayValue,
    )
  ) {
    problems.push(`${invoice}: financial tag changed in D365`);
  }
  if (!offset || offset.status !== 'OK') {
    problems.push(
      `${invoice}: offset account ${row.offsetAccount} is no longer valid (${offset?.status ?? 'missing'})`,
    );
  }
  if (metadata.openBalance !== null) {
    const tolerance = parseDecimalToMicro(
      String(YARD_INVOICE_BALANCE_TOLERANCE_MAJOR),
    );
    const amount = parseDecimalToMicro(String(row.amount));
    if (amount > metadata.openBalance + tolerance) {
      problems.push(`${invoice}: amount exceeds the open balance in D365`);
    }
  }
  return problems;
}

/** Re-reads D365 for every batch row before posting. Read-only. */
@Injectable()
export class YardInvoicePostingRecheck {
  constructor(
    private readonly enrichment: YardInvoiceEnrichmentService,
    private readonly accounts: YardInvoiceAccountResolver,
  ) {}

  public async recheck(
    company: string,
    rows: YardBatchRowSnapshot[],
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const lookups = await this.enrichment.resolveInvoices(
      company,
      rows.map((row) => row.invoiceNumber),
    );
    const requests = rows.map((row) => ({
      paymentType: row.paymentType,
      safeBankAccount: row.offsetAccount,
      paymentDate: row.paymentDate,
      currencyCode: row.currencyCode,
    }));
    const offsets = await this.accounts.resolveMany(company, requests);
    return rows.flatMap((row, index) =>
      compareYardBatchRowToD365(
        row,
        lookups.get(row.invoiceNumber),
        offsets.get(offsetRequestKey(requests[index])),
      ),
    );
  }
}
