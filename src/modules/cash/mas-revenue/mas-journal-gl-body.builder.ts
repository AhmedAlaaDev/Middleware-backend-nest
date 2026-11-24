import {
  accountingExchangeRateFor,
  type MasJournalLiveChecks,
} from './mas-journal-gates';
import {
  buildTransactionText,
  minorToMajor,
  type MasRevenueGlHeaderBody,
  type MasRevenueGlLine,
} from './mas-revenue-gl-body.builder';
import { masRevenueGlPaymentId } from './mas-revenue-identity';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';
import { MasRevenueError, type MasRevenueReceipt } from './mas-revenue.types';

/** Body for POST /data/LedgerJournalHeaders. The journal name is the one the rows state. */
export function buildMasJournalGlHeaderBody(
  journalName: string,
  uploadReference: string,
): MasRevenueGlHeaderBody {
  return {
    dataAreaId: MAS_REVENUE_COMPANY_ID,
    JournalName: journalName,
    Description: `MAS journal ${uploadReference}`.slice(0, 60),
  };
}

/**
 * Builds one GL line per template version 2 row, exactly as the row states it: the
 * accounts on each side, the amount column, the tax group, the posting profile and the
 * dimensions. The line is the same shape the finance team enters in D365: for a receipt
 * the account side is RCash; for a payment the account side is the ledger and the cash
 * account is the offset.
 *
 * Nothing is defaulted. The accounting rate must be a verified one, and the reporting
 * rate for the date must have been read from D365; otherwise nothing is built.
 */
export function buildMasJournalGlLines(
  receipts: readonly MasRevenueReceipt[],
  live: MasJournalLiveChecks,
): MasRevenueGlLine[] {
  return receipts.map((receipt) => {
    const line = receipt.journalLine;
    if (!line) {
      throw new MasRevenueError(
        `row ${receipt.sourceRow} is not a journal-line row`,
      );
    }
    if (!receipt.currency) {
      throw new MasRevenueError(
        `row ${receipt.sourceRow}: the currency is not resolved from the cash account`,
      );
    }
    const exchangeRate = accountingExchangeRateFor(receipt.currency);
    if (exchangeRate === undefined) {
      throw new MasRevenueError(
        `row ${receipt.sourceRow}: no verified accounting exchange rate for ${receipt.currency}`,
      );
    }
    const reporting = live.reportingRates.find(
      (candidate) => candidate.date === receipt.transactionDate,
    );
    if (!reporting || reporting.reportingExchangeRate === null) {
      throw new MasRevenueError(
        `row ${receipt.sourceRow}: no reporting exchange rate for ${receipt.transactionDate}`,
      );
    }

    const text = line.text || receipt.invoiceNumber;
    // Same length rule as the other MAS text: refuse rather than truncate silently.
    buildTransactionText({
      ...receipt,
      customerName: text,
      invoiceNumber: '',
    });
    const amount = minorToMajor(receipt.totalMinor);

    return {
      sourceRow: receipt.sourceRow,
      body: {
        journalNum: '',
        AccountNum: line.account,
        accountTypeStr: line.accountType,
        BANKTRANSACTIONTYPE: '',
        CENTRALBANKPURPOSECODE: '',
        CENTRALBANKPURPOSETEXT: '',
        company: MAS_REVENUE_COMPANY_ID,
        creditAmount: line.side === 'credit' ? amount : 0,
        currency: receipt.currency,
        debitAmount: line.side === 'debit' ? amount : 0,
        DEFAULTDIMENSIONDISPLAYVALUE: line.defaultDimension,
        offsetDEFAULTDIMENSIONDISPLAYVALUE: line.offsetDefaultDimension,
        FinTagStr: line.finTag,
        ISPREPAYMENT: 'No',
        ITEMWITHHOLDINGTAXGROUP: '',
        MarkedLines: [],
        offsetAccountDisplayValue: line.offsetAccount,
        OffsetAccountTypeStr: line.offsetAccountType,
        OffsetCompany: MAS_REVENUE_COMPANY_ID,
        OFFSETFINTAGDISPLAYVALUE: line.offsetFinTag,
        OFFSETTRANSACTIONTEXT: text,
        PAYMENTID: masRevenueGlPaymentId(receipt, 'REV'),
        PAYMENTMETHODNAME: '',
        PAYMENTNOTES: '',
        PAYMENTREFERENCE: '',
        PAYMENTSPECIFICATION: '',
        PostingProfile: line.postingProfile,
        TaxGroup: line.salesTaxGroup,
        TAXITEMGROUP: line.itemSalesTaxGroup,
        transDate: receipt.transactionDate,
        TRANSACTIONTEXT: text,
        DocumentDate: receipt.transactionDate,
        DocumentNum: receipt.invoiceNumber,
        ExchangeRate: exchangeRate,
        ReportingExchangeRate: reporting.reportingExchangeRate,
      },
    };
  });
}
