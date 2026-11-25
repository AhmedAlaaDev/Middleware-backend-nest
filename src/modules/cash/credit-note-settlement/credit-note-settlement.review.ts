import { Injectable } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

import { CREDIT_NOTE_SETTLEMENT_LIMITS } from './credit-note-settlement.constants';
import { CreditNoteSettlementRow } from './credit-note-settlement.parser';

/** CustTransBiEntities fields read for both sides of a pair. */
export interface CustTransRow {
  Invoice: string;
  OrderAccount: string;
  Voucher: string;
  AmountCur: number;
  AmountMST: number;
  SettleAmountCur: number;
  Closed: string;
  CurrencyCode: string;
  TransDate: string;
}

/** FreeTextInvoiceHeaders fields read for the original invoice. */
export interface InvoiceHeaderRow {
  FreeTextNumber: string;
  CustomerAccount: string;
  CurrencyCode: string;
  DefaultDimensionDisplayValue: string;
}

export interface CreditNoteSettlementLookups {
  /** Customer transactions keyed by invoice text. */
  transactions: Map<string, CustTransRow[]>;
  /** Free-text invoice headers keyed by invoice text. */
  headers: Map<string, InvoiceHeaderRow[]>;
}

export interface ReviewedSettlementPair {
  row: CreditNoteSettlementRow;
  status: 'VALID' | 'BLOCKED';
  errors: string[];
  creditNote?: CustTransRow;
  invoice?: CustTransRow;
  /** Default dimension of the original invoice, used on both journal lines. */
  defaultDimension: string;
  /** Amount to settle, positive, two decimals. */
  amount: number;
}

const cents = (value: number): number => Math.round(Math.abs(value) * 100);
const TOLERANCE_CENTS = Math.round(
  CREDIT_NOTE_SETTLEMENT_LIMITS.tolerance * 100,
);

/** 1900 (and 2154-style) dates mean "not closed". */
function isClosed(row: CustTransRow): boolean {
  const year = Number(String(row.Closed ?? '').slice(0, 4));
  return Number.isFinite(year) && year >= 1901 && year <= 2100;
}

function remainingCents(row: CustTransRow): number {
  return cents(row.AmountCur) - cents(row.SettleAmountCur);
}

/**
 * Pure review of the template rows against what D365 holds. A pair is VALID only
 * when the credit note and the invoice both exist once for the customer, are
 * open, have the stated sign and currency, are in the company currency, and both
 * have enough open amount for this row and every earlier row that uses them.
 */
export function reviewCreditNoteSettlements(
  rows: CreditNoteSettlementRow[],
  lookups: CreditNoteSettlementLookups,
): ReviewedSettlementPair[] {
  const used = new Map<string, number>();
  return rows.map((row) => {
    const errors = [...row.errors];
    const amount = row.settleAmount ?? 0;
    const customer = row.customer.trim();
    const pick = (invoice: string, label: string): CustTransRow | undefined => {
      const all = lookups.transactions.get(invoice) ?? [];
      const forCustomer = all.filter(
        (tx) => String(tx.OrderAccount ?? '').trim() === customer,
      );
      if (forCustomer.length === 0) {
        errors.push(
          all.length > 0
            ? `${label} ${invoice} belongs to customer ${all[0].OrderAccount}, not ${customer}`
            : `${label} ${invoice} was not found in D365 for customer ${customer}`,
        );
        return undefined;
      }
      if (forCustomer.length > 1) {
        errors.push(
          `${label} ${invoice} matches ${forCustomer.length} transactions in D365; settle it in D365 instead`,
        );
        return undefined;
      }
      return forCustomer[0];
    };

    if (errors.length > 0) {
      return { row, status: 'BLOCKED', errors, defaultDimension: '', amount };
    }

    const creditNote = pick(row.creditNoteInvoice, 'Credit note');
    const invoice = pick(row.originalInvoice, 'Invoice');

    const checkSide = (
      tx: CustTransRow | undefined,
      label: string,
      invoiceNumber: string,
      voucher: string,
      sign: 'negative' | 'positive',
    ) => {
      if (!tx) return;
      if (voucher && voucher !== String(tx.Voucher ?? '').trim()) {
        errors.push(
          `${label} ${invoiceNumber} has voucher ${tx.Voucher} in D365, not ${voucher}`,
        );
      }
      const amountCur = Number(tx.AmountCur ?? 0);
      if (sign === 'negative' ? !(amountCur < 0) : !(amountCur > 0)) {
        errors.push(
          `${label} ${invoiceNumber} has amount ${amountCur} in D365; expected a ${sign} amount`,
        );
      }
      if (
        String(tx.CurrencyCode ?? '')
          .trim()
          .toUpperCase() !== row.currency
      ) {
        errors.push(
          `${label} ${invoiceNumber} is in ${tx.CurrencyCode} in D365, not ${row.currency}`,
        );
      }
      if (cents(tx.AmountCur) !== cents(tx.AmountMST)) {
        errors.push(
          `${label} ${invoiceNumber} is not in the company currency; only company-currency settlements are supported`,
        );
      }
      if (isClosed(tx)) {
        errors.push(`${label} ${invoiceNumber} is already closed in D365`);
        return;
      }
      const key = `${tx.Voucher}|${invoiceNumber}`;
      const left = remainingCents(tx) - (used.get(key) ?? 0);
      if (left <= 0) {
        errors.push(
          `${label} ${invoiceNumber} has no open amount left in D365`,
        );
      } else if (cents(amount) > left + TOLERANCE_CENTS) {
        errors.push(
          `SettleAmount ${amount} is more than the open amount ${(left / 100).toFixed(2)} of ${label.toLowerCase()} ${invoiceNumber}`,
        );
      }
    };
    checkSide(
      creditNote,
      'Credit note',
      row.creditNoteInvoice,
      row.creditNoteVoucher,
      'negative',
    );
    checkSide(
      invoice,
      'Invoice',
      row.originalInvoice,
      row.originalVoucher,
      'positive',
    );

    const header = (lookups.headers.get(row.originalInvoice) ?? []).find(
      (h) => String(h.CustomerAccount ?? '').trim() === customer,
    );
    const defaultDimension = String(
      header?.DefaultDimensionDisplayValue ?? '',
    ).trim();
    if (invoice && !defaultDimension) {
      errors.push(
        `Invoice ${row.originalInvoice} has no default dimension on its free-text invoice header in D365`,
      );
    }

    if (errors.length > 0 || !creditNote || !invoice) {
      return {
        row,
        status: 'BLOCKED',
        errors,
        creditNote,
        invoice,
        defaultDimension,
        amount,
      };
    }
    for (const [tx, invoiceNumber] of [
      [creditNote, row.creditNoteInvoice],
      [invoice, row.originalInvoice],
    ] as const) {
      const key = `${tx.Voucher}|${invoiceNumber}`;
      used.set(key, (used.get(key) ?? 0) + cents(amount));
    }
    return {
      row,
      status: 'VALID',
      errors,
      creditNote,
      invoice,
      defaultDimension,
      amount,
    };
  });
}

/** Read-only D365 access for the review. */
@Injectable()
export class CreditNoteSettlementD365Reader {
  private static readonly CHUNK = 20;

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  public async read(
    company: string,
    rows: Pick<
      CreditNoteSettlementRow,
      'creditNoteInvoice' | 'originalInvoice'
    >[],
  ): Promise<CreditNoteSettlementLookups> {
    const all = [
      ...new Set(
        rows
          .flatMap((row) => [row.creditNoteInvoice, row.originalInvoice])
          .filter(Boolean),
      ),
    ];
    const originals = [
      ...new Set(rows.map((row) => row.originalInvoice).filter(Boolean)),
    ];
    const transactions = new Map<string, CustTransRow[]>();
    const headers = new Map<string, InvoiceHeaderRow[]>();

    for (const chunk of chunks(all, CreditNoteSettlementD365Reader.CHUNK)) {
      const found = await this.readAll<CustTransRow>(
        this.query.buildQuery('/data/CustTransBiEntities', {
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            `(${this.query.or(...chunk.map((i) => this.query.eq('Invoice', i)))})`,
          ),
          select: [
            'Invoice',
            'OrderAccount',
            'Voucher',
            'AmountCur',
            'AmountMST',
            'SettleAmountCur',
            'Closed',
            'CurrencyCode',
            'TransDate',
          ],
          crossCompany: true,
        }),
      );
      for (const tx of found) {
        const key = String(tx.Invoice ?? '');
        transactions.set(key, [...(transactions.get(key) ?? []), tx]);
      }
    }

    for (const chunk of chunks(
      originals,
      CreditNoteSettlementD365Reader.CHUNK,
    )) {
      const found = await this.readAll<InvoiceHeaderRow>(
        this.query.buildQuery('/data/FreeTextInvoiceHeaders', {
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            `(${this.query.or(...chunk.map((i) => this.query.eq('FreeTextNumber', i)))})`,
          ),
          select: [
            'FreeTextNumber',
            'CustomerAccount',
            'CurrencyCode',
            'DefaultDimensionDisplayValue',
          ],
          crossCompany: true,
        }),
      );
      for (const header of found) {
        const key = String(header.FreeTextNumber ?? '');
        headers.set(key, [...(headers.get(key) ?? []), header]);
      }
    }
    return { transactions, headers };
  }

  private async readAll<T>(endpoint: string): Promise<T[]> {
    const response = await this.d365.get<T>(endpoint, { useCache: false });
    return response.value ?? [];
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
