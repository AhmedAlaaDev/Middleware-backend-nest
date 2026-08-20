import {
  VendorCandidateTransaction,
  VendorInvoiceMatchStatus,
} from './models/vendor-invoice-match-result';
import { VendorPaymentMarkingResult } from './models/vendor-payment-marking-result';
import { VendorInvoiceVerificationService } from './services/vendor-invoice-verification.service';
import { calculateVendorPaymentAmounts, moneyEquals } from './utils/money.util';

import { VendorInvoiceSettlementSnapshot } from '@/modules/d365fo/services/vendor-invoice-journal.service';

export interface VendorPaymentSemanticError {
  field: string;
  message: string;
}

const defaultVerificationService = new VendorInvoiceVerificationService();

/**
 * Validates Vendor Payment decisions against external facts and enforces
 * deterministic 4-stage verification hierarchy:
 * Vendor -> Document Number -> Invoice Number -> Amount
 */
export function validateVendorPaymentSemantics(options: {
  markingResult: VendorPaymentMarkingResult;
  vendorAccount: string;
  documentNumber?: string;
  netPaymentAmount?: number;
  withholdingAmount?: number;
  grossInvoiceAmount?: number;
  sourceId?: string;
  currencyCode?: string;
  allowPartialPayment?: boolean;
  invoiceLookup: (
    invoice: string,
    vendor: string,
  ) => VendorInvoiceSettlementSnapshot;
  verificationService?: VendorInvoiceVerificationService;
}): VendorPaymentSemanticError[] {
  const {
    markingResult,
    vendorAccount,
    documentNumber,
    netPaymentAmount = 0,
    withholdingAmount = 0,
    grossInvoiceAmount,
    invoiceLookup,
    currencyCode = '',
    sourceId,
    allowPartialPayment = false,
    verificationService = defaultVerificationService,
  } = options;

  const errors: VendorPaymentSemanticError[] = [];
  const sourceTag = sourceId ? ` (UniqueId ${sourceId})` : '';

  if (!markingResult.shouldMark) {
    return errors;
  }

  for (const markedLine of markingResult.markedLines) {
    const invoice = markedLine.InvoiceNumber;
    if (!invoice) continue; // Custody uses DocumentNumber instead

    const lineDocNumber =
      markedLine.DocumentNumber || documentNumber || markingResult.documentNum;
    const lookup = invoiceLookup(invoice, vendorAccount);

    if (!lookup.exists) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice}${sourceTag} was not found in D365 for vendor ${vendorAccount}.`,
      });
      continue;
    }

    if (!lookup.belongsToVendor) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice}${sourceTag} does not belong to vendor ${vendorAccount}.`,
      });
      continue;
    }

    if (lookup.isOpen === false) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice}${sourceTag} is already closed/settled in D365 for vendor ${vendorAccount}.`,
      });
      continue;
    }

    if (
      lookup.currencyCode &&
      currencyCode &&
      lookup.currencyCode.trim().toLowerCase() !==
        currencyCode.trim().toLowerCase()
    ) {
      errors.push({
        field: 'CurrencyCode',
        message: `Vendor invoice ${invoice}${sourceTag} is in currency ${lookup.currencyCode}, but the payment line is ${currencyCode}.`,
      });
      continue;
    }

    // Build candidate transactions for full deterministic verification
    const candidates: VendorCandidateTransaction[] =
      lookup.candidateTransactions && lookup.candidateTransactions.length > 0
        ? lookup.candidateTransactions
        : [
            {
              vendorAccount: lookup.vendorAccount || vendorAccount,
              documentNumber: lookup.documentNumber || lineDocNumber || '',
              invoiceNumber: lookup.invoice || invoice,
              currencyCode: lookup.currencyCode || currencyCode,
              originalAmount: lookup.originalAmount ?? 0,
              openAmount: lookup.remainingAmount ?? lookup.originalAmount ?? 0,
              sourceKey: lookup.sourceKey,
              lastSettleVoucher: lookup.lastSettleVoucher,
              isOpen: lookup.isOpen ?? true,
            },
          ];

    const shouldVerifyAmount =
      options.netPaymentAmount !== undefined ||
      options.withholdingAmount !== undefined ||
      options.grossInvoiceAmount !== undefined;

    if (shouldVerifyAmount) {
      const matchResult = verificationService.verify(
        {
          company: lookup.company || '',
          vendorAccount,
          documentNumber: lineDocNumber || '',
          invoiceNumber: invoice,
          grossInvoiceAmount,
          netPaymentAmount,
          withholdingAmount,
          currencyCode,
          allowPartialPayment,
        },
        candidates,
      );

      if (matchResult.status !== VendorInvoiceMatchStatus.MATCHED) {
        const field =
          matchResult.status === VendorInvoiceMatchStatus.DOCUMENT_NOT_FOUND
            ? 'DocumentNumber'
            : matchResult.status === VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND
              ? 'Amount'
              : 'MarkedInvoice';

        errors.push({
          field,
          message: `${matchResult.reason}${sourceTag}`,
        });
      }
    }
  }

  return errors;
}
