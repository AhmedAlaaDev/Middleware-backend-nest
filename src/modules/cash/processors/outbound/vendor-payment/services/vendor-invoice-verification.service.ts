import { Injectable, Logger } from '@nestjs/common';

import {
  VendorCandidateTransaction,
  VendorInvoiceMatchResult,
  VendorInvoiceMatchStatus,
  VendorInvoiceVerificationRequest,
  VendorInvoiceMatchStrategy,
} from '../models/vendor-invoice-match-result';
import {
  calculateVendorPaymentAmounts,
  moneyEquals,
  moneyLessThanOrEqual,
} from '../utils/money.util';
import { vendorInvoiceIdentityEquals } from '../policies/vendor-invoice-identity.policy';

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

    const requestedTransactionId = this.normalize(request.transactionId);
    if (requestedTransactionId) {
      const identityMatches = vendorMatches.filter(
        (candidate) =>
          this.normalize(
            candidate.transactionId || candidate.recId || candidate.sourceKey,
          ) === requestedTransactionId,
      );
      if (identityMatches.length === 1) {
        return {
          status: VendorInvoiceMatchStatus.MATCHED,
          matchedTransaction: identityMatches[0],
          matchStrategy: VendorInvoiceMatchStrategy.TRANSACTION_ID,
          candidateCount: {
            ...candidateCount,
            document: 1,
            invoice: 1,
            amount: 1,
          },
        };
      }
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
      ? documentMatches.filter((c) =>
          vendorInvoiceIdentityEquals(request.invoiceNumber, c.invoiceNumber),
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

    if (request.skipAmountValidation) {
      candidateCount.amount = invoiceMatches.length;

      const openInvoiceMatches = invoiceMatches.filter(
        (candidate) => candidate.isOpen === true,
      );
      const matched =
        openInvoiceMatches.length === 1
          ? openInvoiceMatches[0]
          : (openInvoiceMatches[0] ?? invoiceMatches[0]);

      this.logger.log(
        `[VERIFY] MATCHED: D365 vendor transaction identity verified for Vendor ${request.vendorAccount}, Document ${request.documentNumber || 'n/a'}, Invoice ${request.invoiceNumber || 'n/a'}. Amount validation was skipped because Vendor Payment amounts may be grouped.`,
      );

      return {
        status: VendorInvoiceMatchStatus.MATCHED,
        matchedTransaction: matched,
        candidateCount,
        matchStrategy: normalizedReqDoc
          ? VendorInvoiceMatchStrategy.VENDOR_INVOICE_DOCUMENT
          : VendorInvoiceMatchStrategy.VENDOR_INVOICE_UNIQUE,
      };
    }

    // -------------------------------------------------------------
    // 4. AMOUNT VERIFICATION & ACCEPTANCE
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

      // Standard full settlement: settlementAmount (Net + WHT) or grossInvoiceAmount equals openAmount or originalAmount
      const grossMatch =
        request.grossInvoiceAmount !== undefined &&
        (moneyEquals(
          c.openAmount,
          request.grossInvoiceAmount,
          request.currencyCode,
        ) ||
          moneyEquals(
            c.originalAmount,
            request.grossInvoiceAmount,
            request.currencyCode,
          ));

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
        ) ||
        grossMatch
      );
    });

    const hasDocument = Boolean(normalizedReqDoc);
    candidateCount.amount = amountMatches.length;

    if (amountMatches.length === 0) {
      this.logger.warn(
        `[VERIFY] AMOUNT_NOT_FOUND: Vendor ${request.vendorAccount}, document ${request.documentNumber || 'n/a'}, and invoice ${request.invoiceNumber || 'n/a'} matched, but settlement amount ${expectedSettlementAmount} did not match any candidate open/original amount.`,
      );
      return {
        status: VendorInvoiceMatchStatus.AMOUNT_NOT_FOUND,
        candidateCount,
        reason: `Vendor, document, and invoice matched, but amount was not found. Vendor: ${request.vendorAccount}, Document: ${request.documentNumber || 'n/a'}, Invoice: ${request.invoiceNumber || 'n/a'}, Amount: ${expectedSettlementAmount}`,
      };
    }

    // -------------------------------------------------------------
    // 5. AMBIGUOUS MATCH CHECK
    // -------------------------------------------------------------
    // Historical VendTrans rows can contain both settled copies and one current
    // open transaction for the same vendor/document/invoice/amount. Prefer the
    // single open candidate when it is available; open/closed state must not
    // reject an otherwise valid settlement request.
    const openAmountMatches = amountMatches.filter(
      (candidate) => candidate.isOpen === true,
    );
    const resolvedAmountMatches =
      amountMatches.length > 1 && openAmountMatches.length === 1
        ? openAmountMatches
        : amountMatches;

    if (resolvedAmountMatches.length > 1) {
      this.logger.error(
        `[VERIFY] AMBIGUOUS_MATCH: Found ${amountMatches.length} matching D365 vendor transactions for Vendor ${request.vendorAccount}, Document ${request.documentNumber}, Invoice ${request.invoiceNumber}, Amount ${expectedSettlementAmount}. Posting was stopped to prevent incorrect settlement.`,
      );
      return {
        status: VendorInvoiceMatchStatus.AMBIGUOUS_MATCH,
        candidateCount,
        reason: `Multiple D365 vendor transactions matched: Vendor, Document, Invoice. Posting was stopped to prevent incorrect settlement.`,
        candidateDocuments: resolvedAmountMatches
          .map((candidate) => candidate.documentNumber)
          .filter(Boolean),
      };
    }

    // -------------------------------------------------------------
    // MATCHED
    // -------------------------------------------------------------
    const matched = resolvedAmountMatches[0];
    this.logger.log(
      `[VERIFY] MATCHED: Exact D365 vendor transaction verified for Vendor ${request.vendorAccount}, Document ${request.documentNumber || 'n/a'}, Invoice ${request.invoiceNumber || 'n/a'}, Settlement ${expectedSettlementAmount} (Voucher: ${matched.voucher || matched.sourceKey || 'n/a'}).`,
    );

    return {
      status: VendorInvoiceMatchStatus.MATCHED,
      matchedTransaction: matched,
      candidateCount,
      matchStrategy: hasDocument
        ? VendorInvoiceMatchStrategy.VENDOR_INVOICE_DOCUMENT_AMOUNT
        : VendorInvoiceMatchStrategy.VENDOR_INVOICE_AMOUNT,
    };
  }
}
