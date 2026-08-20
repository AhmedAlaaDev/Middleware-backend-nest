import { Injectable, Logger } from '@nestjs/common';

import {
  VendorCandidateTransaction,
  VendorInvoiceMatchResult,
  VendorInvoiceMatchStatus,
  VendorInvoiceVerificationRequest,
} from '../models/vendor-invoice-match-result';
import {
  calculateVendorPaymentAmounts,
  moneyEquals,
  moneyLessThanOrEqual,
} from '../utils/money.util';

@Injectable()
export class VendorInvoiceVerificationService {
  private readonly logger = new Logger(VendorInvoiceVerificationService.name);

  public normalize(value?: string | number | null): string {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  public verify(
    request: VendorInvoiceVerificationRequest,
    candidates: VendorCandidateTransaction[],
  ): VendorInvoiceMatchResult {
    const candidateCount = {
      initial: candidates.length,
      vendor: 0,
      document: 0,
      invoice: 0,
      amount: 0,
    };

    const normalizedReqVendor = this.normalize(request.vendorAccount);
    const normalizedReqDoc = this.normalize(request.documentNumber);
    const normalizedReqInvoice = this.normalize(request.invoiceNumber);

    // -------------------------------------------------------------
    // 1. VENDOR VERIFICATION
    // -------------------------------------------------------------
    const vendorMatches = candidates.filter(
      (c) => this.normalize(c.vendorAccount) === normalizedReqVendor,
    );
    candidateCount.vendor = vendorMatches.length;

    if (vendorMatches.length === 0) {
      this.logger.warn(
        `[VERIFY] VENDOR_NOT_FOUND: Vendor ${request.vendorAccount} had 0 matches from ${candidates.length} initial candidate(s).`,
      );
      return {
        status: VendorInvoiceMatchStatus.VENDOR_NOT_FOUND,
        candidateCount,
        reason: `Vendor transaction not found. Vendor: ${request.vendorAccount}`,
      };
    }

    // -------------------------------------------------------------
    // 2. DOCUMENT NUMBER VERIFICATION
    // -------------------------------------------------------------
    const documentMatches = normalizedReqDoc
      ? vendorMatches.filter(
          (c) => this.normalize(c.documentNumber) === normalizedReqDoc,
        )
      : vendorMatches;
    candidateCount.document = documentMatches.length;

    if (normalizedReqDoc && documentMatches.length === 0) {
      this.logger.warn(
        `[VERIFY] DOCUMENT_NOT_FOUND: Vendor ${request.vendorAccount} found, but document number ${request.documentNumber} had 0 matches from ${vendorMatches.length} vendor transaction(s).`,
      );
      return {
        status: VendorInvoiceMatchStatus.DOCUMENT_NOT_FOUND,
        candidateCount,
        reason: `Vendor found but document number was not found. Vendor: ${request.vendorAccount}, Document: ${request.documentNumber}`,
      };
    }

    // -------------------------------------------------------------
    // 3. INVOICE NUMBER VERIFICATION
    // -------------------------------------------------------------
    const invoiceMatches = normalizedReqInvoice
      ? documentMatches.filter(
          (c) => this.normalize(c.invoiceNumber) === normalizedReqInvoice,
        )
      : documentMatches;
    candidateCount.invoice = invoiceMatches.length;

    if (normalizedReqInvoice && invoiceMatches.length === 0) {
      this.logger.warn(
        `[VERIFY] INVOICE_NOT_FOUND: Vendor ${request.vendorAccount} and document ${request.documentNumber || 'n/a'} matched, but invoice ${request.invoiceNumber} had 0 matches from ${documentMatches.length} document transaction(s).`,
      );
      return {
        status: VendorInvoiceMatchStatus.INVOICE_NOT_FOUND,
        candidateCount,
        reason: `Vendor and document matched, but invoice was not found. Vendor: ${request.vendorAccount}, Document: ${request.documentNumber || 'n/a'}, Invoice: ${request.invoiceNumber}`,
      };
    }

    // -------------------------------------------------------------
    // 4. AMOUNT VERIFICATION
    // -------------------------------------------------------------
    const amounts = calculateVendorPaymentAmounts({
      netPaymentAmount: request.netPaymentAmount,
      withholdingAmount: request.withholdingAmount,
      grossInvoiceAmount: request.grossInvoiceAmount,
      currencyCode: request.currencyCode,
    });
    const expectedSettlementAmount = amounts.settlementAmount;

    const amountMatches = invoiceMatches.filter((c) => {
      // If currency is provided, currency must match
      if (
        request.currencyCode &&
        c.currencyCode &&
        this.normalize(request.currencyCode) !== this.normalize(c.currencyCode)
      ) {
        return false;
      }

      if (request.allowPartialPayment) {
        // For partial payment, settlementAmount must be <= openAmount or equal to open/original
        return (
          moneyLessThanOrEqual(
            expectedSettlementAmount,
            c.openAmount,
            request.currencyCode,
          ) ||
          moneyEquals(
            c.openAmount,
            expectedSettlementAmount,
            request.currencyCode,
          ) ||
          moneyEquals(
            c.originalAmount,
            expectedSettlementAmount,
            request.currencyCode,
          )
        );
      }

      // Standard full settlement: settlementAmount (Net + WHT) equals openAmount or originalAmount
      return (
        moneyEquals(
          c.openAmount,
          expectedSettlementAmount,
          request.currencyCode,
        ) ||
        moneyEquals(
          c.originalAmount,
          expectedSettlementAmount,
          request.currencyCode,
        )
      );
    });
    candidateCount.amount = amountMatches.length;

    if (amountMatches.length === 0) {
      this.logger.warn(
        `[VERIFY] AMOUNT_NOT_FOUND: Vendor ${request.vendorAccount}, document ${request.documentNumber || 'n/a'}, and invoice ${request.invoiceNumber || 'n/a'} matched, but expected settlement amount ${expectedSettlementAmount} (Net: ${amounts.netPaymentAmount} + WHT: ${amounts.withholdingAmount}) did not match candidate open/original amounts.`,
      );
      return {
        status: VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND,
        candidateCount,
        reason: `Vendor, document and invoice matched, but amount did not match. Expected settlement: ${expectedSettlementAmount} (Net: ${amounts.netPaymentAmount} + WHT: ${amounts.withholdingAmount})`,
      };
    }

    // -------------------------------------------------------------
    // 5. AMBIGUOUS MATCH CHECK
    // -------------------------------------------------------------
    if (amountMatches.length > 1) {
      this.logger.error(
        `[VERIFY] AMBIGUOUS_MATCH: Found ${amountMatches.length} matching D365 vendor transactions for Vendor ${request.vendorAccount}, Document ${request.documentNumber}, Invoice ${request.invoiceNumber}, Amount ${expectedSettlementAmount}. Posting was stopped to prevent incorrect settlement.`,
      );
      return {
        status: VendorInvoiceMatchStatus.AMBIGUOUS_MATCH,
        candidateCount,
        reason: `Multiple D365 vendor transactions matched: Vendor, Document, Invoice, Amount. Posting was stopped to prevent incorrect settlement.`,
      };
    }

    // -------------------------------------------------------------
    // EXACT MATCH
    // -------------------------------------------------------------
    const matched = amountMatches[0];
    this.logger.log(
      `[VERIFY] MATCHED: Exact D365 vendor transaction verified for Vendor ${request.vendorAccount}, Document ${request.documentNumber || 'n/a'}, Invoice ${request.invoiceNumber || 'n/a'}, Settlement ${expectedSettlementAmount} (Voucher: ${matched.voucher || matched.sourceKey || 'n/a'}).`,
    );

    return {
      status: VendorInvoiceMatchStatus.MATCHED,
      matchedTransaction: matched,
      candidateCount,
    };
  }
}
