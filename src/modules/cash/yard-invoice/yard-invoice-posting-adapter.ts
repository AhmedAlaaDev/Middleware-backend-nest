import { YardOffsetAccountResolution } from './yard-invoice-account.resolver';
import { YardInvoiceGroup } from './yard-invoice-aggregation';
import { microToString } from './yard-invoice-decimal';
import {
  YardInvoiceLookupResult,
  YardInvoiceMetadata,
} from './yard-invoice-lookup.types';

import { EntryRawDataModel } from '@/modules/entry-processor/models';

/**
 * Maps one validated, consolidated Yard invoice group to the existing Cash-In
 * Yard source-row contract (EntryRawDataModel keys read by
 * CashInDirectLineBuilder). This is pure: it takes already-validated inputs
 * and never reads D365 or the workbook.
 *
 * Field mapping (business rules tracked in docs/cash-in-yard-invoice-upload.md):
 *   ACCOUNTTYPE                 'Cust'
 *   ACCOUNTDISPLAYVALUE         D365 CustTrans AccountNum (invoice customer)
 *   DEFAULTDIMENSIONDISPLAYVALUE D365 FreeTextInvoiceHeaders.DefaultDimensionDisplayValue
 *   FINTAGDISPLAYVALUE          D365 posted receivable-line tag
 *   OFFSETACCOUNTTYPE           'Petty cash' (Cash) or 'Bank' (other types)
 *   OFFSETACCOUNTDISPLAYVALUE   template SAFE_BankAccount (trimmed), validated
 *   OFFSETFINTAGDISPLAYVALUE    same invoice tag (assumption to confirm)
 *   CREDITAMOUNT                consolidated rounded total (receipt)
 *   DEBITAMOUNT                 0
 *   CURRENCYCODE                invoice currency (validated = upload currency)
 *   TRANSDATE                   template PaymentDate (YYYY-MM-DD)
 *   INVOICE                     template InvoiceNumber (exact text)
 *   PAYMENTID                   first PaymentSerial by source row; all serials
 *                               are kept on the job for traceability
 *   PAYMENTREFERENCE            template PaymentReference
 *   VOUCHERTYPE                 template Payment Type (Cash/Cheque/Transfer/Deposit)
 *   SafeType                    'Customer Collection' (required by the direct
 *                               Cash-In validator)
 *   DESCRIPTION                 'Yard receipt <invoice>'
 */
export interface YardPostingSourceMapping {
  /** Index of this row in the adapter output (0-based). */
  rowIndex: number;
  invoiceNumber: string;
  sourceRefs: string[];
  paymentSerials: string[];
  roundedTotalText: string;
}

export interface YardPostingAdapterInput {
  group: YardInvoiceGroup;
  metadata: YardInvoiceMetadata;
  offsetAccount: YardOffsetAccountResolution;
}

export class YardPostingAdapterError extends Error {}

export function buildYardCashInSourceRows(inputs: YardPostingAdapterInput[]): {
  rows: EntryRawDataModel[];
  mapping: YardPostingSourceMapping[];
} {
  const rows: EntryRawDataModel[] = [];
  const mapping: YardPostingSourceMapping[] = [];

  inputs.forEach((input, index) => {
    const { group, metadata, offsetAccount } = input;
    if (offsetAccount.status !== 'OK' || !offsetAccount.accountType) {
      throw new YardPostingAdapterError(
        `invoice ${group.invoiceNumber}: offset account not validated (${offsetAccount.status})`,
      );
    }
    if (metadata.invoiceNumber !== group.invoiceNumber) {
      throw new YardPostingAdapterError(
        `invoice ${group.invoiceNumber}: metadata belongs to another invoice`,
      );
    }
    if (
      !metadata.customerAccount ||
      !metadata.financialTagDisplayValue ||
      !metadata.defaultDimensionDisplayValue
    ) {
      throw new YardPostingAdapterError(
        `invoice ${group.invoiceNumber}: D365 customer, dimension or tag is missing`,
      );
    }
    if (group.roundedTotal <= 0n) {
      throw new YardPostingAdapterError(
        `invoice ${group.invoiceNumber}: consolidated amount must be positive`,
      );
    }

    const lineNumber = index + 1;
    const row = {
      UniqueId: lineNumber,
      LINENUMBER: lineNumber,
      TRANSDATE: group.paymentDate,
      DESCRIPTION: `Yard receipt ${group.invoiceNumber}`,
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: metadata.customerAccount,
      DEFAULTDIMENSIONDISPLAYVALUE: metadata.defaultDimensionDisplayValue,
      FINTAGDISPLAYVALUE: metadata.financialTagDisplayValue,
      OFFSETACCOUNTTYPE: offsetAccount.accountType,
      OFFSETACCOUNTDISPLAYVALUE: offsetAccount.accountDisplayValue,
      OFFSETFINTAGDISPLAYVALUE: metadata.financialTagDisplayValue,
      CURRENCYCODE: metadata.currencyCode,
      EXCHANGERATE: 0,
      CREDITAMOUNT: Number(microToString(group.roundedTotal)),
      DEBITAMOUNT: 0,
      INVOICE: group.invoiceNumber,
      PAYMENTID: group.paymentSerials[0] ?? '',
      PAYMENTREFERENCE: group.paymentReference,
      VOUCHERTYPE: group.paymentType,
      VoucherType: group.paymentType,
      SafeType: 'Customer Collection',
      DOCUMENT: '',
      DOCUMENTDATE: group.paymentDate,
      DUEDATE: '',
    } as unknown as EntryRawDataModel;

    rows.push(row);
    mapping.push({
      rowIndex: index,
      invoiceNumber: group.invoiceNumber,
      sourceRefs: [...group.sourceRefs],
      paymentSerials: [...group.paymentSerials],
      roundedTotalText: microToString(group.roundedTotal),
    });
  });

  return { rows, mapping };
}

/** Helper for callers that hold lookups keyed by invoice number. */
export function metadataFromLookup(
  lookup: YardInvoiceLookupResult | undefined,
): YardInvoiceMetadata {
  if (!lookup || lookup.status !== 'FOUND') {
    throw new YardPostingAdapterError(
      `D365 lookup not FOUND (${lookup?.status ?? 'missing'})`,
    );
  }
  return lookup.metadata;
}
