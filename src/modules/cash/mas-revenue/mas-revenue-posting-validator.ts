import { compositeCarriesDimensions } from './mas-revenue-config';
import { MAS_REVENUE_PAYMENT_ID_MAX_LENGTH } from './mas-revenue-identity';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

import { isCashPaymentReferenceTooLong } from '@/modules/cash/policies/cash-payment-reference.policy';

/**
 * Structural validation for MAS Revenue journal groups, used only by the MAS posting
 * branch. The shared cash validator is not changed or bypassed for other flows.
 *
 * The one deliberate difference: the offset's default-dimension string is required
 * only when the offset account text does not already carry its dimensions. A ledger
 * combination such as 415701|2401|024|002|005 carries them, so a second copy would be
 * redundant. The cash side keeps its default dimension, because a cash ID has none.
 * Nothing is filled with placeholder values.
 */

export interface MasRevenuePostingGroupLike {
  header: Record<string, unknown>;
  lines: Array<{
    dataAreaId?: unknown;
    LineNumber?: unknown;
    cashDirection?: unknown;
    customLineApiBody?: Record<string, unknown>;
  }>;
}

/** The explicit tax groups every line must carry, exactly as configured. */
export interface MasRevenueExpectedTaxGroups {
  salesTaxGroup: string;
  itemSalesTaxGroup: string;
}

export function validateMasRevenueJournalGroups(
  groups: readonly MasRevenuePostingGroupLike[],
  expectedTax: MasRevenueExpectedTaxGroups,
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
      if (line.cashDirection !== 'in')
        errors.push(`${where}: cashDirection must be "in"`);

      if (!text(body.AccountNum))
        errors.push(`${where}: AccountNum (cash ID) is required`);
      if (body.accountTypeStr !== 'RCash')
        errors.push(`${where}: accountTypeStr must be "RCash"`);
      if (text(body.company) !== MAS_REVENUE_COMPANY_ID)
        errors.push(`${where}: company must be "${MAS_REVENUE_COMPANY_ID}"`);
      if (!text(body.currency)) errors.push(`${where}: currency is required`);
      if (!text(body.transDate)) errors.push(`${where}: transDate is required`);

      // PaymentId is the identity used for retry matching. It must be present and fit
      // the limit. An over-long id is refused, never truncated.
      const paymentId = text(body.PAYMENTID);
      if (!paymentId) {
        errors.push(`${where}: PAYMENTID is required`);
      } else if (paymentId.length > MAS_REVENUE_PAYMENT_ID_MAX_LENGTH) {
        errors.push(
          `${where}: PAYMENTID exceeds ${MAS_REVENUE_PAYMENT_ID_MAX_LENGTH} characters (${paymentId.length}); it is not truncated`,
        );
      }

      // Cash side: a cash ID carries no dimensions, so its default dimension is required.
      if (!text(body.DEFAULTDIMENSIONDISPLAYVALUE)) {
        errors.push(
          `${where}: cash default dimension is required (a cash ID does not carry dimensions)`,
        );
      }

      const offsetAccount = text(body.offsetAccountDisplayValue);
      if (!offsetAccount) {
        errors.push(`${where}: offset account is required`);
      } else if (
        !compositeCarriesDimensions(offsetAccount) &&
        !text(body.offsetDEFAULTDIMENSIONDISPLAYVALUE)
      ) {
        errors.push(
          `${where}: offset account ${offsetAccount} has no dimensions and no default dimension`,
        );
      }
      if (body.OffsetAccountTypeStr !== 'Ledger')
        errors.push(`${where}: OffsetAccountTypeStr must be "Ledger"`);
      if (text(body.OffsetCompany) !== MAS_REVENUE_COMPANY_ID)
        errors.push(
          `${where}: OffsetCompany must be "${MAS_REVENUE_COMPANY_ID}"`,
        );

      // Exact match with the configured, company-scoped tax groups. No line is re-mapped.
      if (body.TaxGroup !== expectedTax.salesTaxGroup) {
        errors.push(
          `${where}: TaxGroup must be "${expectedTax.salesTaxGroup}" (configured sales-tax group)`,
        );
      }
      if (body.TAXITEMGROUP !== expectedTax.itemSalesTaxGroup) {
        errors.push(
          `${where}: TAXITEMGROUP must be "${expectedTax.itemSalesTaxGroup}" (configured item sales-tax group)`,
        );
      }
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
