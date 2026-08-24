import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { filterCashSettlementLines } from '@/modules/cash/policies/cash-line.policy';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

type AmountSource = 'ACCOUNT' | 'OFFSET';

type BuildLine = (
  sourceId: string,
  accountLine?: CashEntryRawDataModel,
  offsetLine?: CashEntryRawDataModel,
  amountSource?: AmountSource,
  exchangeRateContext?: CashOutExchangeRateContext,
) => CashEntryDynDataModel;

/** Selects the direction-specific formatter without changing its arguments. */
export function buildCashLine(options: {
  inbound: boolean;
  sourceId: string;
  accountLine?: CashEntryRawDataModel;
  offsetLine?: CashEntryRawDataModel;
  amountSource?: AmountSource;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildInbound: BuildLine;
  buildOutbound: BuildLine;
}): CashEntryDynDataModel {
  const {
    inbound,
    sourceId,
    accountLine,
    offsetLine,
    amountSource,
    exchangeRateContext,
    buildInbound,
    buildOutbound,
  } = options;
  const build = inbound ? buildInbound : buildOutbound;

  return build(
    sourceId,
    accountLine,
    offsetLine,
    amountSource ?? 'OFFSET',
    exchangeRateContext,
  );
}

/**
 * Builds grouped Cash-In/Cash-Out lines for the two supported group shapes.
 * Direction-specific line formatting stays behind the buildLine callback.
 */
export function buildCashTwoLines(options: {
  sourceId: string;
  lines: CashEntryRawDataModel[];
  inbound: boolean;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildLine: BuildLine;
}): CashEntryDynDataModel[] {
  const { sourceId, lines, inbound, exchangeRateContext, buildLine } = options;
  if (inbound) {
    const customerLines = lines.filter((line) => line.IsCustomer);
    const paymentLines = getCashInPaymentLines(lines);

    return paymentLines.map((paymentLine, paymentIndex) =>
      buildLine(
        sourceId,
        resolveCashInCustomerLine(paymentLine, customerLines, paymentIndex),
        paymentLine,
        'OFFSET',
        exchangeRateContext,
      ),
    );
  }

  const accountLine = inbound
    ? lines.find((line) => line.IsCustomer)
    : lines.find((line) => line.DEBITAMOUNT > 0);
  const offsetLine = inbound
    ? lines.find((line) => !line.IsCustomer)
    : lines.find((line) => line.CREDITAMOUNT > 0);

  return [
    buildLine(
      sourceId,
      accountLine,
      offsetLine,
      undefined,
      exchangeRateContext,
    ),
  ];
}

/**
 * Builds groups containing more than two source lines, including the existing
 * settlement-offset filtering and invalid-shape fallback behavior.
 */
export function buildCashMoreThanTwoLines(options: {
  sourceId: string;
  lines: CashEntryRawDataModel[];
  inbound: boolean;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildLine: BuildLine;
  parseDimensionString: (displayValue?: string) => EntryDimensionsModel;
}): CashEntryDynDataModel[] {
  const {
    sourceId,
    lines,
    inbound,
    exchangeRateContext,
    buildLine,
    parseDimensionString,
  } = options;

  if (inbound) {
    const customerLines = lines.filter((line) => line.IsCustomer);
    const paymentLines = getCashInPaymentLines(lines);

    return paymentLines.map((paymentLine, paymentIndex) =>
      buildLine(
        sourceId,
        resolveCashInCustomerLine(paymentLine, customerLines, paymentIndex),
        paymentLine,
        'OFFSET',
        exchangeRateContext,
      ),
    );
  }

  const accountLines = inbound
    ? lines.filter((line) => line.IsCustomer)
    : lines.filter((line) => line.DEBITAMOUNT > 0);
  const offsetLines = inbound
    ? lines.filter((line) => !line.IsCustomer)
    : lines.filter((line) => line.CREDITAMOUNT > 0);
  const settlementSink: CashEntryRawDataModel[] = [];

  if (accountLines.length > 1 && offsetLines.length === 1) {
    return accountLines.map((accountLine) =>
      buildLine(
        sourceId,
        accountLine,
        offsetLines[0],
        'ACCOUNT',
        exchangeRateContext,
      ),
    );
  }

  if (accountLines.length === 1 && offsetLines.length > 1) {
    const filteredOffsetLines = filterCashSettlementLines(
      offsetLines,
      settlementSink,
      (displayValue) => parseDimensionString(displayValue),
    );

    return filteredOffsetLines.map((offsetLine) =>
      buildLine(
        sourceId,
        accountLines[0],
        offsetLine,
        'OFFSET',
        exchangeRateContext,
      ),
    );
  }

  // Preserve a uniquely-determined side so the downstream invalid-line
  // builder can report which specific side (customer or non-customer) is
  // missing, instead of a generic "both missing" message.
  return [
    buildLine(
      sourceId,
      accountLines.length === 1 ? accountLines[0] : undefined,
      offsetLines.length === 1 ? offsetLines[0] : undefined,
      undefined,
      exchangeRateContext,
    ),
  ];
}

/** Returns only debit-side Cash-In payment rows; 421103 is a settlement row. */
function getCashInPaymentLines(
  lines: CashEntryRawDataModel[],
): CashEntryRawDataModel[] {
  return lines.filter((line) => {
    const accountType = String(line.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isLedgerLine = line.IsLedger || accountType === 'ledger';
    const isPaymentType =
      line.IsPettyCash ||
      line.IsBank ||
      line.IsLedger ||
      accountType === 'petty cash' ||
      accountType === 'bank' ||
      accountType === 'ledger';

    if (!isPaymentType || Number(line.DEBITAMOUNT ?? 0) <= 0) return false;
    return !(
      isLedgerLine &&
      String(line.ACCOUNTDISPLAYVALUE ?? '')
        .trim()
        .startsWith('421103')
    );
  });
}

/** Resolves the customer associated with one payment row without currency grouping. */
function resolveCashInCustomerLine(
  paymentLine: CashEntryRawDataModel,
  customerLines: CashEntryRawDataModel[],
  paymentIndex: number,
): CashEntryRawDataModel | undefined {
  if (customerLines.length <= 1) return customerLines[0];

  const paymentInvoice = String(
    paymentLine.INVOICE || paymentLine.DOCUMENT || '',
  )
    .trim()
    .toLowerCase();
  if (paymentInvoice) {
    const invoiceMatch = customerLines.find(
      (line) =>
        String(line.INVOICE || line.DOCUMENT || '')
          .trim()
          .toLowerCase() === paymentInvoice,
    );
    if (invoiceMatch) return invoiceMatch;
  }

  const paymentVoucher = String(paymentLine.VOUCHER ?? '').trim();
  const voucherMatch = customerLines.find(
    (line) => String(line.VOUCHER ?? '').trim() === paymentVoucher,
  );
  return voucherMatch ?? customerLines[paymentIndex] ?? customerLines[0];
}
