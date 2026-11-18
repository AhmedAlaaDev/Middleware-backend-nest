import {
  absMicro,
  Micro,
  microToString,
  roundMicroToCurrency,
} from './yard-invoice-decimal';
import { YardPaymentRecord } from './yard-invoice-record';

import { getCurrencyDecimals } from '@/modules/cash/processors/outbound/vendor-payment/utils/money.util';

export interface YardInvoiceAggregationIssue {
  invoiceNumber: string;
  /** Source references such as "yard.!17489" or "Template!2". */
  sourceRefs: string[];
  message: string;
}

/** One source row that contributes to a consolidated invoice. */
export interface YardSourceRef {
  sourceSheet: string;
  sourceRow: number;
  paymentSerial: string | null;
  amountText: string;
  amount: Micro;
  workbookCustomerAccount: string | null;
  workbookDimension: string | null;
  workbookFinTag: string | null;
  paymentReference: string;
}

export interface YardInvoiceGroup {
  invoiceNumber: string;
  currencyCode: string;
  paymentType: string;
  safeBankAccount: string;
  paymentDate: string;
  /** Shared reference for the group; rows must agree (see errors). */
  paymentReference: string;
  /** Contributing source rows, in workbook order. */
  sources: YardSourceRef[];
  /** Serials of contributing rows, when the format has serials. */
  paymentSerials: string[];
  /** Sheet!row labels for display and audit. */
  sourceRefs: string[];
  rawTotal: Micro;
  rawTotalText: string;
  decimals: number;
  roundedTotal: Micro;
  roundedTotalText: string;
  /** rounded - raw: the rounding change applied to this invoice. */
  roundingChange: Micro;
  roundingChangeText: string;
  /** |raw - rounded|, reported so the reviewer sees the material difference. */
  roundingVariance: Micro;
  roundingVarianceText: string;
  /** Workbook values seen across the group (Yards format only). */
  workbookCustomerAccounts: string[];
  workbookDimensions: string[];
  workbookFinTags: string[];
  /** True when any contributing row is a credit note. */
  isCreditNote: boolean;
  /** Empty when the group is consolidatable. */
  errors: string[];
}

export interface YardInvoiceAggregationResult {
  groups: YardInvoiceGroup[];
  issues: YardInvoiceAggregationIssue[];
}

const FIELDS_THAT_MUST_AGREE = [
  'currencyCode',
  'paymentType',
  'safeBankAccount',
  'paymentDate',
  'paymentReference',
] as const;

const WORKBOOK_FIELDS_THAT_MUST_AGREE = [
  'workbookCustomerAccount',
  'workbookDimension',
  'workbookFinTag',
] as const;

/**
 * Canonical form used only to detect distinct invoices that would collapse
 * into one key. Lookups use the exact trimmed invoice text.
 */
export function invoiceCollisionKey(invoiceNumber: string): string {
  return invoiceNumber.toUpperCase().replace(/\s+/g, '');
}

function refOf(record: YardPaymentRecord): string {
  return `${record.sourceSheet}!${record.sourceRow}`;
}

/**
 * Consolidates payment records into one group per exact invoice number.
 * Rows are never reordered, split or chosen by "first row wins". A group whose
 * rows disagree on a posting field or on a workbook value gets errors and is
 * not consolidatable. Credit notes are kept in the group for review and block it.
 */
export function aggregateYardInvoiceRecords(
  records: YardPaymentRecord[],
): YardInvoiceAggregationResult {
  const issues: YardInvoiceAggregationIssue[] = [];

  const variantsByKey = new Map<string, Set<string>>();
  for (const record of records) {
    const key = invoiceCollisionKey(record.invoiceNumber);
    const set = variantsByKey.get(key) ?? new Set<string>();
    set.add(record.invoiceNumber);
    variantsByKey.set(key, set);
  }
  const blockedInvoices = new Set<string>();
  for (const [key, variants] of variantsByKey) {
    if (variants.size <= 1) continue;
    const list = [...variants];
    for (const variant of list) {
      blockedInvoices.add(variant);
      issues.push({
        invoiceNumber: variant,
        sourceRefs: records
          .filter((r) => r.invoiceNumber === variant)
          .map(refOf),
        message: `invoice numbers ${list.map((v) => `"${v}"`).join(', ')} collide after normalization (${key}); distinct invoices are never merged`,
      });
    }
  }

  const serialRows = new Map<string, YardPaymentRecord[]>();
  for (const record of records) {
    if (record.paymentSerial === null) continue;
    const list = serialRows.get(record.paymentSerial) ?? [];
    list.push(record);
    serialRows.set(record.paymentSerial, list);
  }
  const duplicateSerialRefs = new Set<string>();
  for (const [serial, list] of serialRows) {
    if (list.length > 1) {
      list.forEach((r) => duplicateSerialRefs.add(refOf(r)));
      issues.push({
        invoiceNumber: '',
        sourceRefs: list.map(refOf),
        message: `PaymentSerial "${serial}" appears on multiple rows; a repeated payment would be counted twice`,
      });
    }
  }

  const byInvoice = new Map<string, YardPaymentRecord[]>();
  for (const record of records) {
    if (blockedInvoices.has(record.invoiceNumber)) continue;
    const list = byInvoice.get(record.invoiceNumber) ?? [];
    list.push(record);
    byInvoice.set(record.invoiceNumber, list);
  }

  const groups: YardInvoiceGroup[] = [];
  for (const [invoiceNumber, rows] of byInvoice) {
    const first = rows[0];
    const errors: string[] = [];

    for (const field of FIELDS_THAT_MUST_AGREE) {
      const values = new Set(rows.map((r) => String(r[field] ?? '')));
      if (values.size > 1) {
        errors.push(
          `rows disagree on ${field} (${[...values].join(' vs ')}); correct the rows so they agree`,
        );
      }
    }
    for (const field of WORKBOOK_FIELDS_THAT_MUST_AGREE) {
      const values = new Set(rows.map((r) => String(r[field] ?? '')));
      if (values.size > 1) {
        errors.push(
          `rows disagree on the workbook ${field} (${[...values].join(' vs ')}); the source must be corrected`,
        );
      }
    }

    if (rows.some((r) => duplicateSerialRefs.has(refOf(r)))) {
      errors.push('contains a repeated PaymentSerial (see file-level issue)');
    }

    const isCreditNote = rows.some((r) => r.isCreditNote);
    if (isCreditNote) {
      errors.push(
        'credit note (-CN): not supported by the Yard cash receipt flow; the file cannot be submitted until these rows are removed or handled outside this flow',
      );
    }
    if (!isCreditNote && rows.some((r) => r.amount <= 0n)) {
      errors.push('contains a zero or negative amount');
    }

    const decimals = getCurrencyDecimals(first.currencyCode);
    const rawTotal = rows.reduce<Micro>((sum, r) => sum + r.amount, 0n);
    const { rounded, unit } = roundMicroToCurrency(rawTotal, decimals);
    const variance = absMicro(rawTotal - rounded);
    if (variance > unit / 2n) {
      errors.push(
        `rounding to ${decimals} decimals changes the total by ${microToString(variance)}, more than half a minor unit; rejected`,
      );
    }

    const distinct = (values: (string | null)[]) => [
      ...new Set(values.filter((v): v is string => v !== null && v !== '')),
    ];

    groups.push({
      invoiceNumber,
      currencyCode: first.currencyCode,
      paymentType: first.paymentType,
      safeBankAccount: first.safeBankAccount,
      paymentDate: first.paymentDate,
      paymentReference: first.paymentReference,
      sources: rows.map((r) => ({
        sourceSheet: r.sourceSheet,
        sourceRow: r.sourceRow,
        paymentSerial: r.paymentSerial,
        amountText: r.amountText,
        amount: r.amount,
        workbookCustomerAccount: r.workbookCustomerAccount,
        workbookDimension: r.workbookDimension,
        workbookFinTag: r.workbookFinTag,
        paymentReference: r.paymentReference,
      })),
      paymentSerials: rows
        .map((r) => r.paymentSerial)
        .filter((s): s is string => s !== null),
      sourceRefs: rows.map(refOf),
      rawTotal,
      rawTotalText: microToString(rawTotal),
      decimals,
      roundedTotal: rounded,
      roundedTotalText: microToString(rounded),
      roundingChange: rounded - rawTotal,
      roundingChangeText: microToString(rounded - rawTotal),
      roundingVariance: variance,
      roundingVarianceText: microToString(variance),
      workbookCustomerAccounts: distinct(
        rows.map((r) => r.workbookCustomerAccount),
      ),
      workbookDimensions: distinct(rows.map((r) => r.workbookDimension)),
      workbookFinTags: distinct(rows.map((r) => r.workbookFinTag)),
      isCreditNote,
      errors,
    });
  }

  return { groups, issues };
}
