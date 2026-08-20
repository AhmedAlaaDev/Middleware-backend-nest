import { VendorPaymentJournalLines } from './models/vendor-payment-journal-lines';
import { resolveVendorPaymentInvoice } from './policies/vendor-payment-invoice.policy';
import { classifyVendorPaymentLines } from './policies/vendor-payment-line.policy';
import {
  resolveVendorPaymentMarking,
  VendorPaymentSettlement,
} from './policies/vendor-payment-marked-lines.policy';
import { resolveVendorPaymentOffset } from './policies/vendor-payment-offset.policy';
import {
  findVendorPaymentWithholdingLine,
  isVendorPaymentWithholdingEnabled,
} from './policies/vendor-payment-withholding.policy';
import {
  VendorPaymentBuilder,
  VendorPaymentBuildContext,
} from './vendor-payment.builder';
import { VendorPaymentDirector } from './vendor-payment.director';
import { validateVendorPaymentSemantics } from './vendor-payment.semantic-validator';
import { validateVendorPaymentStructure } from './vendor-payment.structural-validator';
import { moneyEquals } from './utils/money.util';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { VendorInvoiceSettlementSnapshot } from '@/modules/d365fo/services/vendor-invoice-journal.service';

export interface VendorPaymentProcessorDependencies {
  company: string;
  isTrucking: boolean;
  invoiceLookup: (
    invoice: string,
    vendor: string,
  ) => VendorInvoiceSettlementSnapshot;
  resolveExchangeRate: (
    date: string,
    currency: string,
  ) => { exchangeRate: number; reportingRate: number };
  resolveDimensions: (line: CashEntryRawDataModel) => string;
  resolveJournalName: () => string;
  replaceFinTagShippingLine: (value: string) => string;
  formatMonthYear: (date: string) => string;
  getCashCollectionDescriptionLabel: () => string;
}

export interface VendorPaymentProcessorResult {
  lines: VendorPaymentJournalLines[];
  errors: Array<{ field: string; message: string }>;
}

/**
 * Orchestrates Vendor Payment processing in the corrected order:
 * Classify → Validate structure → Lookup → Policy decides → Validate semantics → Builder builds
 */
export function processVendorPaymentGroup(
  sourceId: string,
  lines: CashEntryRawDataModel[],
  deps: VendorPaymentProcessorDependencies,
): VendorPaymentProcessorResult {
  // 1. Classify lines
  const classification = classifyVendorPaymentLines(lines);

  // 2. Validate structure (pre-lookup)
  const structuralErrors = validateVendorPaymentStructure(
    classification,
    sourceId,
  );
  if (structuralErrors.length > 0) {
    return { lines: [], errors: structuralErrors };
  }

  const paymentOffset = classification.paymentOffset!;
  const director = new VendorPaymentDirector();
  const results: VendorPaymentJournalLines[] = [];
  const allErrors: Array<{ field: string; message: string }> = [];

  // Group vendor lines by vendor account + vendor group
  const vendorGroups = new Map<string, CashEntryRawDataModel[]>();
  for (const vendorLine of classification.vendorDebitLines) {
    const key = [
      String(vendorLine.ACCOUNTDISPLAYVALUE ?? '')
        .trim()
        .toLowerCase(),
      String(vendorLine.VendorGroup ?? '')
        .trim()
        .toLowerCase(),
    ].join('|');
    if (!vendorGroups.has(key)) vendorGroups.set(key, []);
    vendorGroups.get(key)!.push(vendorLine);
  }

  for (const groupLines of vendorGroups.values()) {
    const primaryVendor = groupLines[0];
    const vendorAccount = String(
      primaryVendor.ACCOUNTDISPLAYVALUE ?? '',
    ).trim();
    const vendorGroup = String(primaryVendor.VendorGroup ?? '').trim();

    // 3. Build settlements (match withholding lines to vendor lines)
    const settlements: VendorPaymentSettlement[] = groupLines.map(
      (vendorLine) => ({
        vendorLine,
        withholdingLine: findVendorPaymentWithholdingLine(
          vendorLine,
          classification.withholdingLines,
        ),
      }),
    );

    // 4. Resolve invoice
    const invoice = resolveVendorPaymentInvoice(primaryVendor, paymentOffset);

    // 5. Resolve marking (SINGLE SOURCE OF TRUTH)
    const markingResult = resolveVendorPaymentMarking({
      settlements,
      offsetLine: paymentOffset,
      vendorGroup,
    });

    // 6. Validate semantics (post-lookup with deterministic verification)
    const vendorDebitSum = groupLines.reduce(
      (sum, line) => sum + Number(line.DEBITAMOUNT ?? 0),
      0,
    );
    const withholdingAmount = settlements.reduce((sum, { withholdingLine }) => {
      return (
        sum +
        (withholdingLine
          ? Number(
              withholdingLine.CREDITAMOUNT || withholdingLine.DEBITAMOUNT || 0,
            )
          : 0)
      );
    }, 0);
    const offsetCredit = Number(paymentOffset.CREDITAMOUNT ?? 0);
    const currency = String(
      primaryVendor.CURRENCYCODE || paymentOffset.CURRENCYCODE || '',
    ).trim();

    let netPaymentAmount = vendorDebitSum;
    let grossInvoiceAmount = vendorDebitSum;

    if (withholdingAmount > 0) {
      if (
        offsetCredit > 0 &&
        moneyEquals(vendorDebitSum, offsetCredit + withholdingAmount, currency)
      ) {
        netPaymentAmount = offsetCredit;
        grossInvoiceAmount = vendorDebitSum;
      } else {
        netPaymentAmount = vendorDebitSum;
        grossInvoiceAmount = vendorDebitSum + withholdingAmount;
      }
    }
    const documentNumber = String(primaryVendor.DOCUMENT ?? '').trim();

    const semanticErrors = validateVendorPaymentSemantics({
      markingResult,
      vendorAccount,
      documentNumber,
      netPaymentAmount,
      withholdingAmount,
      grossInvoiceAmount,
      sourceId,
      currencyCode: currency,
      invoiceLookup: deps.invoiceLookup,
    });
    if (semanticErrors.length > 0) {
      allErrors.push(...semanticErrors);
      continue;
    }

    // 7. Resolve offset
    const offset = resolveVendorPaymentOffset(
      primaryVendor,
      paymentOffset,
      deps.company,
    );

    // 8. Resolve FX
    const transactionDate = primaryVendor.TRANSDATE || paymentOffset.TRANSDATE;
    const currencyCode =
      primaryVendor.CURRENCYCODE || paymentOffset.CURRENCYCODE;
    const { exchangeRate, reportingRate } = deps.resolveExchangeRate(
      transactionDate,
      currencyCode,
    );

    // 9. Resolve withholding
    const primarySettlement = settlements[0];
    const isWithholding = settlements.some(({ vendorLine, withholdingLine }) =>
      isVendorPaymentWithholdingEnabled({
        vendorLine,
        withholdingLine,
        offsetLine: paymentOffset,
      }),
    );

    // 10. Build dimensions
    const dimensionStr = deps.resolveDimensions(primaryVendor);

    // 11. Description
    const formattedDate = deps.formatMonthYear(transactionDate);
    const label = deps.getCashCollectionDescriptionLabel();
    const descriptionSuffix = !markingResult.shouldMark ? ' - unmarked' : '';
    const description = `Vendor Payment - ${label} ${formattedDate} (${primaryVendor.VoucherType})${descriptionSuffix}`;

    // 12. Tax
    const salesTaxGroup =
      paymentOffset.SALESTAXGROUP?.trim()?.toLowerCase() || '';
    const itemSalesTaxGroup =
      paymentOffset.ITEMSALESTAXGROUP?.trim()?.toLowerCase() || '';
    const isTaxable = salesTaxGroup === 'taxable' && !!itemSalesTaxGroup;

    // 13. Debit amount (sum of all vendor lines in group)
    const debitAmount = groupLines.reduce(
      (sum, line) => sum + Number(line.DEBITAMOUNT ?? 0),
      0,
    );

    // 14. Build context and construct product
    const context: VendorPaymentBuildContext = {
      accountDisplayValue: vendorAccount,
      accountType: primaryVendor.ACCOUNTTYPE,
      vendorGroup,
      debitAmount,
      currencyCode,
      exchangeRate,
      reportingCurrencyExchRate: reportingRate,
      transactionDate,
      description,
      transactionText: description,
      offsetTransactionText: offset.paymentReference,
      paymentMethodName: offset.paymentMethodName,
      paymentReference: offset.paymentReference,
      offsetAccountDisplayValue: offset.offsetAccountDisplayValue,
      offsetAccountType: offset.offsetAccountType,
      offsetCompany: offset.offsetCompany,
      journalName: deps.resolveJournalName(),
      defaultDimensionDisplayValue: dimensionStr,
      offsetDefaultDimensionDisplayValue: dimensionStr,
      finTagDisplayValue: deps.replaceFinTagShippingLine(
        primaryVendor.FINTAGDISPLAYVALUE,
      ),
      offsetFinTagDisplayValue: deps.replaceFinTagShippingLine(
        paymentOffset.FINTAGDISPLAYVALUE || '',
      ),
      salesTaxGroup: isTaxable ? 'Taxable' : 'Non-Taxabl',
      itemSalesTaxGroup,
      isWithholdingCalculationEnabled: isWithholding ? 'Yes' : 'No',
      itemWithholdingTaxGroupCode:
        primarySettlement.vendorLine.ITEMWITHHOLDINGTAXGROUPCODE ||
        primarySettlement.withholdingLine?.ITEMWITHHOLDINGTAXGROUPCODE ||
        paymentOffset.ITEMWITHHOLDINGTAXGROUPCODE ||
        '',
      postingProfile:
        primaryVendor.POSTINGPROFILE?.trim() ||
        paymentOffset.POSTINGPROFILE?.trim() ||
        '',
      invoice,
      documentDate: primaryVendor.DOCUMENTDATE || '',
      dueDate: primaryVendor.DUEDATE || '',
      voucherType: primaryVendor.VoucherType || '',
      safeType: 'Vendor Payment',
      paymentId: sourceId,
      document: String(primaryVendor.DOCUMENT ?? '').trim(),
      settlementTargetType: primaryVendor.IsCustodyVendor
        ? 'CustodyLedger'
        : 'VendorInvoice',
      markingResult,
    };

    const product = director.construct(new VendorPaymentBuilder(), context);
    results.push(product);
  }

  return { lines: results, errors: allErrors };
}
