import { Logger, BadRequestException } from '@nestjs/common';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CashInTransactionGroup {
  uniqueId?: string | number;
  safeType?: string;
  lines: CashEntryRawDataModel[];
}

/**
 * Resolves whether an account display string matches main account 421103.
 * Handles display values with financial dimensions (e.g. 421103, 421103-BU01, 421103|1301).
 */
export function is421103Account(accountDisplayValue?: string): boolean {
  if (!accountDisplayValue) return false;
  const trimmed = String(accountDisplayValue).trim();
  const mainAccount = trimmed.split(/[-|]/)[0]?.trim();
  return mainAccount === '421103';
}

/**
 * Standard Cash-In 421103 Currency Synchronization Policy.
 *
 * For standard Cash-In transaction groups (UniqueId), when a Customer credit line
 * is associated with a Ledger 421103 line, copy ONLY the CURRENCYCODE from the
 * 421103 line to the Customer credit line.
 *
 * All debit and credit amounts MUST remain strictly unchanged.
 * The 421103 line itself MUST be preserved for normal Cash-In accounting processing.
 */
export class CashIn421103CurrencyPolicy {
  private static readonly logger = new Logger(CashIn421103CurrencyPolicy.name);

  public static apply(group: CashInTransactionGroup): void {
    if (!group || !group.lines || group.lines.length === 0) {
      return;
    }

    // AC9: Custody Settlement groups are routed to Cash-Out and excluded from this rule.
    const safeTypeToken = String(group.safeType ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (safeTypeToken === 'custodysettlement') {
      return;
    }

    // Identify Ledger 421103 lines
    const ledger421103Lines = group.lines.filter(
      (line) =>
        (line.IsLedger ||
          String(line.ACCOUNTTYPE ?? '').trim().toLowerCase() === 'ledger') &&
        is421103Account(line.ACCOUNTDISPLAYVALUE),
    );

    // AC10: If no 421103 line, do nothing.
    if (ledger421103Lines.length === 0) {
      return;
    }

    // AC7: Target Customer credit lines (AccountType = Cust and CreditAmount > 0)
    const customerCreditLines = group.lines.filter(
      (line) =>
        (line.IsCustomer ||
          String(line.ACCOUNTTYPE ?? '').trim().toLowerCase() === 'cust') &&
        (line.CREDITAMOUNT ?? 0) > 0,
    );

    if (customerCreditLines.length === 0) {
      return;
    }

    for (const customerLine of customerCreditLines) {
      const ledgerLine = this.resolveMatching421103Line(
        customerLine,
        ledger421103Lines,
        group,
      );

      if (!ledgerLine) {
        continue;
      }

      const sourceCurrency = String(ledgerLine.CURRENCYCODE ?? '').trim();

      // AC11: Invalid/missing 421103 CurrencyCode generates a clear validation error.
      if (!sourceCurrency) {
        throw new BadRequestException(
          `Unable to apply Cash-In 421103 currency rule because the matched Ledger 421103 line does not contain a valid CurrencyCode. ` +
            `(UniqueId=${group.uniqueId ?? customerLine.UniqueId}, CustomerLine=${customerLine.LINENUMBER}, LedgerLine=${ledgerLine.LINENUMBER})`,
        );
      }

      // Preserve original amounts for defensive assertions
      const originalCustomerDebit = customerLine.DEBITAMOUNT;
      const originalCustomerCredit = customerLine.CREDITAMOUNT;
      const originalLedgerDebit = ledgerLine.DEBITAMOUNT;
      const originalLedgerCredit = ledgerLine.CREDITAMOUNT;
      const previousCustomerCurrency = String(
        customerLine.CURRENCYCODE ?? '',
      ).trim();

      // Currency-only transformation (AC1, AC3, AC4)
      customerLine.CURRENCYCODE = sourceCurrency;

      // Defensive assertions (AC2, AC6, AC12)
      if (customerLine.DEBITAMOUNT !== originalCustomerDebit) {
        throw new Error(
          '421103 currency rule assertion failure: Customer DebitAmount was illegally modified.',
        );
      }
      if (customerLine.CREDITAMOUNT !== originalCustomerCredit) {
        throw new Error(
          '421103 currency rule assertion failure: Customer CreditAmount was illegally modified.',
        );
      }
      if (ledgerLine.DEBITAMOUNT !== originalLedgerDebit) {
        throw new Error(
          '421103 currency rule assertion failure: Ledger 421103 DebitAmount was illegally modified.',
        );
      }
      if (ledgerLine.CREDITAMOUNT !== originalLedgerCredit) {
        throw new Error(
          '421103 currency rule assertion failure: Ledger 421103 CreditAmount was illegally modified.',
        );
      }

      if (previousCustomerCurrency !== sourceCurrency) {
        this.logger.log(
          `Cash-In 421103 currency rule applied. Customer currency updated from the related Ledger 421103 line. ` +
            `UniqueId=${group.uniqueId ?? customerLine.UniqueId} ` +
            `Voucher=${customerLine.VOUCHER || ledgerLine.VOUCHER || ''} ` +
            `CustomerLine=${customerLine.LINENUMBER} ` +
            `CustomerAccount=${customerLine.ACCOUNTDISPLAYVALUE} ` +
            `LedgerLine=${ledgerLine.LINENUMBER} ` +
            `LedgerAccountDisplayValue=${ledgerLine.ACCOUNTDISPLAYVALUE} ` +
            `PreviousCustomerCurrency=${previousCustomerCurrency} ` +
            `SourceCurrency=${sourceCurrency} ` +
            `FinalCustomerCurrency=${customerLine.CURRENCYCODE} ` +
            `CustomerDebitAmount=${customerLine.DEBITAMOUNT} ` +
            `CustomerCreditAmount=${customerLine.CREDITAMOUNT} ` +
            `421103DebitAmount=${ledgerLine.DEBITAMOUNT} ` +
            `421103CreditAmount=${ledgerLine.CREDITAMOUNT}`,
        );
      }
    }
  }

  private static resolveMatching421103Line(
    customerLine: CashEntryRawDataModel,
    ledger421103Lines: CashEntryRawDataModel[],
    group: CashInTransactionGroup,
  ): CashEntryRawDataModel | undefined {
    if (ledger421103Lines.length === 1) {
      return ledger421103Lines[0];
    }

    // Deterministic matching: Voucher -> Invoice -> Document -> LineNumber
    const customerVoucher = (customerLine.VOUCHER || '').trim();
    if (customerVoucher) {
      const voucherMatches = ledger421103Lines.filter(
        (l) => (l.VOUCHER || '').trim() === customerVoucher,
      );
      if (voucherMatches.length === 1) return voucherMatches[0];
    }

    const customerInvoice = (
      customerLine.INVOICE ||
      customerLine.DOCUMENT ||
      ''
    ).trim();
    if (customerInvoice) {
      const invoiceMatches = ledger421103Lines.filter((l) => {
        const lInv = (l.INVOICE || l.DOCUMENT || '').trim();
        return lInv && lInv === customerInvoice;
      });
      if (invoiceMatches.length === 1) return invoiceMatches[0];
    }

    // Ambiguous matching failure
    throw new BadRequestException(
      `Unable to determine the matching Ledger 421103 line for the Cash-In customer line. ` +
        `(UniqueId=${group.uniqueId ?? customerLine.UniqueId}, CustomerLine=${customerLine.LINENUMBER})`,
    );
  }
}
