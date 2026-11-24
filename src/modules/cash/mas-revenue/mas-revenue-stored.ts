import { MAS_REVENUE_IDENTITY_VERSION } from './mas-revenue-identity';

import type { MasRevenueReceipt } from './mas-revenue.types';

/**
 * Raw row stored in the data batch for one accepted receipt. The batch keeps
 * this snapshot so reprocessing and posting rebuild the same receipt, without
 * reading the uploaded file again. Money stays in integer minor units.
 */
export interface MasRevenueStoredRaw {
  LINENUMBER: number;
  SourceSheet: string;
  SourceRow: number;
  InvoiceNumber: string;
  TransactionDate: string;
  Currency: string;
  ValueMinor: number;
  VatMinor: number;
  TotalMinor: number;
  CashAccountDisplayName: string;
  CustomerName: string;
  ContainerType: string | null;
  ContainerNumber: string | null;
  BillOfLading: string | null;
  RevenueType: string | null;
  SeaLine: string | null;
  VatCardNumber: string | null;
  /**
   * Identity scheme this snapshot was created under. Absent on snapshots stored
   * before version 2; those keep their legacy PaymentIds.
   */
  IdentityVersion?: number;
}

export function receiptToStoredRaw(
  receipt: MasRevenueReceipt,
  lineNumber: number,
): MasRevenueStoredRaw {
  return {
    LINENUMBER: lineNumber,
    SourceSheet: receipt.sourceSheet,
    SourceRow: receipt.sourceRow,
    InvoiceNumber: receipt.invoiceNumber,
    TransactionDate: receipt.transactionDate,
    Currency: receipt.currency,
    ValueMinor: receipt.valueMinor,
    VatMinor: receipt.vatMinor,
    TotalMinor: receipt.totalMinor,
    CashAccountDisplayName: receipt.cashAccountDisplayName,
    CustomerName: receipt.customerName,
    ContainerType: receipt.containerType,
    ContainerNumber: receipt.containerNumber,
    BillOfLading: receipt.billOfLading,
    RevenueType: receipt.revenueType,
    SeaLine: receipt.seaLine,
    VatCardNumber: receipt.vatCardNumber,
    IdentityVersion: MAS_REVENUE_IDENTITY_VERSION,
  };
}

export function storedRawToReceipt(
  raw: MasRevenueStoredRaw,
): MasRevenueReceipt {
  return {
    sourceSheet: raw.SourceSheet,
    sourceRow: raw.SourceRow,
    invoiceNumber: raw.InvoiceNumber,
    transactionDate: raw.TransactionDate,
    currency: raw.Currency,
    valueMinor: raw.ValueMinor,
    vatMinor: raw.VatMinor,
    totalMinor: raw.TotalMinor,
    cashAccountDisplayName: raw.CashAccountDisplayName,
    customerName: raw.CustomerName,
    containerType: raw.ContainerType,
    containerNumber: raw.ContainerNumber,
    billOfLading: raw.BillOfLading,
    revenueType: raw.RevenueType,
    seaLine: raw.SeaLine,
    vatCardNumber: raw.VatCardNumber,
    identityVersion: raw.IdentityVersion,
  };
}

/** Month isolation and the 1,000-line journal limit used by the existing Cash In processors. */
export const MAS_REVENUE_MAX_LINES_PER_JOURNAL = 1000;

/**
 * Planned journal grouping: one group per calendar month of the receipt date,
 * split into chunks of at most 1,000 lines. Receipts are never split across groups.
 */
export function masRevenueJournalBatchNumber(
  transactionDate: string,
  chunkIndex: number,
): string {
  const yyyymm = transactionDate.slice(0, 7).replace('-', '');
  return `MASREV-${yyyymm}-${String(chunkIndex).padStart(3, '0')}`;
}
