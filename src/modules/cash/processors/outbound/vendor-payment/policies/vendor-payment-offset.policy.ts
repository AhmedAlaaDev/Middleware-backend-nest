import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { resolveCashPaymentMethod } from '@/modules/cash/policies/cash-line.policy';

export interface VendorPaymentOffsetResolution {
  offsetAccountDisplayValue: string;
  offsetAccountType: string;
  paymentMethodName: string;
  paymentReference: string;
  offsetCompany: string;
}

/**
 * Resolves offset account information for a Vendor Payment.
 * Responsible for: payment offset identification, offset account type,
 * offset account display value, payment method source ownership.
 */
export function resolveVendorPaymentOffset(
  accountLine: CashEntryRawDataModel,
  offsetLine: CashEntryRawDataModel,
  company: string,
): VendorPaymentOffsetResolution {
  return {
    offsetAccountDisplayValue: String(
      offsetLine.ACCOUNTDISPLAYVALUE ?? '',
    ).trim(),
    offsetAccountType: offsetLine.ACCOUNTTYPE ?? '',
    paymentMethodName: resolveCashPaymentMethod(accountLine, offsetLine),
    paymentReference:
      offsetLine.PAYMENTREFERENCE ||
      `${offsetLine.DESCRIPTION || ''} - Freight`,
    offsetCompany: company,
  };
}
