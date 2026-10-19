import { EntryAccountType } from '@/common/types';
import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { findCashBankMisclassificationError } from '@/modules/cash/policies/cash-account-classification.policy';
import {
  sanitizeCashBankAccountDimension,
  toCashDefaultDimensionDisplayValue,
} from '@/modules/cash/policies/cash-dimension.policy';
import { collectCashInDirectSourceErrors } from '@/modules/cash/processors/inbound/direct/cash-in-direct-line.validator';
import { createCashInboundDynamicLine } from '@/modules/cash/services/cash-in-line-building.service';
import { CashOutExchangeRateResolution } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

export interface CashInDirectLineBuilderContext {
  company: string;
  requireInvoice: boolean;
  parseDimensionString: (displayValue?: string) => EntryDimensionsModel;
  getDimensionSegmentLength: (displayValue?: string) => number;
  isValidDimensionSegmentLength: (segmentLength: number) => boolean;
  fetchExchangeRates: (
    transactionDate: string,
    currencyCode: string,
  ) => { exchangeRate: number; reportingRate: number };
  resolveReportingExchangeRate: (
    transactionDate: string,
    currencyCode: string,
  ) => CashOutExchangeRateResolution;
  getCustomerName: (customerAccount: string) => string | undefined;
}

/**
 * Maps one already-complete Cash-In source row (customer + offset on the same
 * Excel line) into the customer-payment journal format. Invoice identity and
 * amounts are taken from the sheet; Freight/Fleet pairing and rewrite rules
 * are intentionally not applied.
 */
export class CashInDirectLineBuilder {
  constructor(private readonly context: CashInDirectLineBuilderContext) {}

  public build(row: CashEntryRawDataModel): CashEntryDynDataModel {
    const dimensionSource = this.resolveDimensionSource(row);
    const segmentLength =
      this.context.getDimensionSegmentLength(dimensionSource);
    const dimensions = this.context.parseDimensionString(dimensionSource);
    sanitizeCashBankAccountDimension(dimensions);

    const dimensionDisplayValue = toCashDefaultDimensionDisplayValue(
      dimensions,
      false,
    );
    const invoiceNumber = String(row.INVOICE ?? '').trim();
    const currencyCode = String(row.CURRENCYCODE ?? '')
      .trim()
      .toUpperCase();
    const offsetAccountType = String(
      row.OFFSETACCOUNTTYPE ?? '',
    ).trim() as EntryAccountType;
    const offsetAccountDisplayValue = this.resolveOffsetAccountDisplayValue(
      row,
      offsetAccountType,
    );
    const {
      exchangeRate,
      reportingRate,
      exchangeRateError,
      reportingRateError,
    } =
      this.resolveRates(row, currencyCode);

    const dynLine = createCashInboundDynamicLine(dimensions, {
      SourceIds: [String(row.UniqueId || row.LINENUMBER || '')],
      LineNumber: row.LINENUMBER,
      Description: row.DESCRIPTION || '',
      TransactionText: row.DESCRIPTION || '',
      Company: this.context.company,
      AccountType: row.ACCOUNTTYPE,
      OffsetAccountType: offsetAccountType,
      PaymentMethodName: String(row.PAYMENTMETHOD ?? '').trim(),
      PaymentReference: row.PAYMENTREFERENCE || '',
      JournalName: 'Cust-Pay',
      TransactionDate: row.TRANSDATE,
      TransDate: row.TRANSDATE,
      AccountDisplayValue: String(row.ACCOUNTDISPLAYVALUE ?? '').trim(),
      OffsetAccountDisplayValue: offsetAccountDisplayValue,
      FinTagDisplayValue:
        row.FINTAGDISPLAYVALUE || row.OFFSETFINTAGDISPLAYVALUE || '',
      OffsetFinTagDisplayValue:
        row.OFFSETFINTAGDISPLAYVALUE || row.FINTAGDISPLAYVALUE || '',
      CreditAmount: Number(row.CREDITAMOUNT ?? 0),
      DebitAmount: Number(row.DEBITAMOUNT ?? 0),
      CurrencyCode: currencyCode,
      ExchRate: exchangeRate,
      ExchangeRate: exchangeRate,
      ReportingCurrencyExchRate: reportingRate,
      CustomerName:
        this.context.getCustomerName(
          String(row.ACCOUNTDISPLAYVALUE ?? '').trim(),
        ) || '',
      DefaultDimensionsForAccountDisplayValue: dimensionDisplayValue,
      DefaultDimensionsForOffsetAccountDisplayValue: dimensionDisplayValue,
      SalesTaxGroup: row.SALESTAXGROUP,
      OffsetCompany: this.context.company,
      PostingProfile: String(row.POSTINGPROFILE ?? '').trim(),
      Invoice: invoiceNumber,
      MarkedInvoice: invoiceNumber,
      dataAreaId: this.context.company,
      SecondaryExchangeRate: Number(row.EXCHANGERATESECONDARY ?? 0),
      Document: row.DOCUMENT,
      DocumentDate: row.DOCUMENTDATE || row.TRANSDATE,
      DueDate: row.DUEDATE,
      // ShipLink and Yard provide the Finance payment identifier in
      // PAYMENTID. UniqueId is only the middleware/source-row identity and
      // must not be sent as the payment id for these direct Cash-In lines.
      PaymentId: String(row.PAYMENTID ?? '').trim(),
      SafeType: row.SafeType,
      VoucherType: row.VoucherType,
      SettlementIntent: 'Unmarked',
      MarkedLines: [],
      SourceLineNumber: row.LINENUMBER,
    });

    for (const error of collectCashInDirectSourceErrors(row, {
      requireInvoice: this.context.requireInvoice,
    })) {
      dynLine.AddError(error.field, error.message);
    }

    if (exchangeRateError) {
      dynLine.AddError('ExchangeRate', exchangeRateError);
    }

    if (reportingRateError) {
      dynLine.AddError('ReportingExchangeRate', reportingRateError);
    }

    if (!this.context.isValidDimensionSegmentLength(segmentLength)) {
      dynLine.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${segmentLength}. Expected 19 or 20 segments.`,
      );
    }

    const accountBankMisclassification = findCashBankMisclassificationError(
      dynLine.AccountType,
      dynLine.AccountDisplayValue,
    );
    if (accountBankMisclassification) {
      dynLine.AddError('AccountType', accountBankMisclassification);
    }

    const offsetBankMisclassification = findCashBankMisclassificationError(
      dynLine.OffsetAccountType,
      dynLine.OffsetAccountDisplayValue,
    );
    if (offsetBankMisclassification) {
      dynLine.AddError('OffsetAccountType', offsetBankMisclassification);
    }

    return dynLine;
  }

  private resolveDimensionSource(row: CashEntryRawDataModel): string {
    return (
      String(row.OFFSETDEFAULTDIMENSIONDISPLAYVALUE ?? '').trim() ||
      String(row.DEFAULTDIMENSIONDISPLAYVALUE ?? '').trim() ||
      String(row.OFFSETACCOUNTDISPLAYVALUE ?? '').trim()
    );
  }

  private resolveOffsetAccountDisplayValue(
    row: CashEntryRawDataModel,
    offsetAccountType: string,
  ): string {
    const raw = String(row.OFFSETACCOUNTDISPLAYVALUE ?? '').trim();
    if (offsetAccountType.toLowerCase() === 'ledger' && raw.includes('|')) {
      return raw.split('|')[0]?.trim() || raw;
    }
    return raw;
  }

  private resolveRates(
    row: CashEntryRawDataModel,
    currencyCode: string,
  ): {
    exchangeRate: number;
    reportingRate: number;
    exchangeRateError?: string;
    reportingRateError?: string;
  } {
    const reportingResolution = this.context.resolveReportingExchangeRate(
      row.TRANSDATE,
      currencyCode,
    );
    let exchangeRate = Number(row.EXCHANGERATE ?? 0);
    const reportingRate = reportingResolution.rate;
    const reportingRateError =
      reportingResolution.kind === 'missing'
        ? reportingResolution.message
        : undefined;

    if (currencyCode === 'EGP') {
      return {
        exchangeRate: 100,
        reportingRate,
        reportingRateError,
      };
    }

    if (exchangeRate > 0) {
      return { exchangeRate, reportingRate, reportingRateError };
    }

    try {
      const fetched = this.context.fetchExchangeRates(
        row.TRANSDATE,
        currencyCode,
      );
      exchangeRate = fetched.exchangeRate;
    } catch (error) {
      return {
        exchangeRate: 0,
        reportingRate,
        exchangeRateError: `No valid exchange rate for currency ${currencyCode || '(empty)'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        reportingRateError,
      };
    }

    if (!(exchangeRate > 0)) {
      return {
        exchangeRate: 0,
        reportingRate,
        exchangeRateError: `No valid exchange rate for currency ${currencyCode || '(empty)'}.`,
        reportingRateError,
      };
    }

    return {
      exchangeRate,
      reportingRate,
      reportingRateError,
    };
  }
}
