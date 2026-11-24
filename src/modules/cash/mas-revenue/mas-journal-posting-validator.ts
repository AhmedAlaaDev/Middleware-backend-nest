import { compositeCarriesDimensions } from './mas-revenue-config';
import { MAS_REVENUE_PAYMENT_ID_MAX_LENGTH } from './mas-revenue-identity';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

import type { MasRevenuePostingGroupLike } from './mas-revenue-posting-validator';

import { isCashPaymentReferenceTooLong } from '@/modules/cash/policies/cash-payment-reference.policy';

/**
 * Structural validation for template version 2 journal groups. A row states its own
 * accounts, so nothing is compared with configured values. What is checked is that
 * each line is a well-formed petty-cash journal line: one side is RCash and the other
 * a ledger account, exactly one amount column is used, and the identity and the tax
 * groups are present. Whether D365 accepts the accounts and groups was checked live
 * before this point.
 *
 * `cashDirection` on the line is the label of the posting route (the GL route), not
 * the money direction; the money direction is the side of the amount.
 */
export function validateMasJournalGroups(
  groups: readonly MasRevenuePostingGroupLike[],
): string[] {
  const errors: string[] = [];
  groups.forEach((group, groupIndex) => {
    const header = group.header;
    for (const field of ['dataAreaId', 'JournalName', 'Description']) {
      if (!text(header[field])) {
        errors.push(`journal ${groupIndex + 1}: header ${field} is required`);
      }
    }
    if (text(header.dataAreaId) !== MAS_REVENUE_COMPANY_ID) {
      errors.push(
        `journal ${groupIndex + 1}: header company must be "${MAS_REVENUE_COMPANY_ID}"`,
      );
    }

    group.lines.forEach((line) => {
      const lineNumber =
        typeof line.LineNumber === 'number' ||
        typeof line.LineNumber === 'string'
          ? line.LineNumber
          : '?';
      const where = `journal ${groupIndex + 1}, line ${lineNumber}`;
      const body = line.customLineApiBody;
      if (!body) {
        errors.push(`${where}: missing line body`);
        return;
      }
      if (text(line.dataAreaId) !== MAS_REVENUE_COMPANY_ID)
        errors.push(`${where}: dataAreaId must be "${MAS_REVENUE_COMPANY_ID}"`);
      if (line.LineNumber === undefined || line.LineNumber === null)
        errors.push(`${where}: LineNumber is required`);
      if (text(body.company) !== MAS_REVENUE_COMPANY_ID)
        errors.push(`${where}: company must be "${MAS_REVENUE_COMPANY_ID}"`);
      if (text(body.OffsetCompany) !== MAS_REVENUE_COMPANY_ID)
        errors.push(
          `${where}: OffsetCompany must be "${MAS_REVENUE_COMPANY_ID}"`,
        );
      if (!text(body.currency)) errors.push(`${where}: currency is required`);
      if (!text(body.transDate)) errors.push(`${where}: transDate is required`);

      const accountType = text(body.accountTypeStr);
      const offsetType = text(body.OffsetAccountTypeStr);
      const account = text(body.AccountNum);
      const offsetAccount = text(body.offsetAccountDisplayValue);
      if (!account) errors.push(`${where}: account is required`);
      if (!offsetAccount) errors.push(`${where}: offset account is required`);
      const cashOnAccount = accountType === 'RCash' && offsetType === 'Ledger';
      const cashOnOffset = accountType === 'Ledger' && offsetType === 'RCash';
      if (!cashOnAccount && !cashOnOffset) {
        errors.push(
          `${where}: one side must be RCash (petty cash) and the other Ledger`,
        );
      }

      const debit = Number(body.debitAmount ?? 0);
      const credit = Number(body.creditAmount ?? 0);
      if (!(debit > 0) && !(credit > 0)) {
        errors.push(`${where}: an amount greater than zero is required`);
      }
      if (debit > 0 && credit > 0) {
        errors.push(`${where}: use either debit or credit, not both`);
      }

      const paymentId = text(body.PAYMENTID);
      if (!paymentId) {
        errors.push(`${where}: PAYMENTID is required`);
      } else if (paymentId.length > MAS_REVENUE_PAYMENT_ID_MAX_LENGTH) {
        errors.push(
          `${where}: PAYMENTID exceeds ${MAS_REVENUE_PAYMENT_ID_MAX_LENGTH} characters (${paymentId.length}); it is not truncated`,
        );
      }

      // The cash side's default dimension is optional: finance enters receipts without
      // one (journal GL-GNL-0000000000271). The ledger side needs dimensions, either in
      // its composite or as its default dimension.
      const ledgerAccount = cashOnAccount ? offsetAccount : account;
      const ledgerDimension = cashOnAccount
        ? text(body.offsetDEFAULTDIMENSIONDISPLAYVALUE)
        : text(body.DEFAULTDIMENSIONDISPLAYVALUE);
      if (
        ledgerAccount &&
        (cashOnAccount || cashOnOffset) &&
        !compositeCarriesDimensions(ledgerAccount) &&
        !ledgerDimension
      ) {
        errors.push(
          `${where}: ledger account ${ledgerAccount} has no dimensions and no default dimension`,
        );
      }

      // The sales-tax group is optional on the row; the item sales-tax group is not.
      if (!text(body.TAXITEMGROUP))
        errors.push(`${where}: item sales-tax group is required`);
      if (
        isCashPaymentReferenceTooLong(
          body.PAYMENTREFERENCE as string | undefined,
        )
      ) {
        errors.push(`${where}: PAYMENTREFERENCE is too long`);
      }
    });
  });
  return errors;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
