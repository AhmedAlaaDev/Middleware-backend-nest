import { VendorPaymentSettlementIntent } from '../models/vendor-payment-marking-result';

export class VendorPaymentDescriptionPolicy {
  getDescription(input: {
    settlementState: VendorPaymentSettlementIntent;
    target?: string;
    monthYear?: string;
    voucherType?: string;
    invoiceNumber?: string;
  }): string {
    const targetAndPeriod = [input.target?.trim(), input.monthYear?.trim()]
      .filter(Boolean)
      .join(' ');
    const voucherType = this.formatVoucherType(input.voucherType);
    const businessDescription = [
      targetAndPeriod
        ? `Vendor Payment - ${targetAndPeriod}`
        : 'Vendor Payment',
      voucherType ? `(${voucherType})` : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (input.settlementState === VendorPaymentSettlementIntent.UNMARKED) {
      const invoiceNumber = input.invoiceNumber?.trim();
      return invoiceNumber
        ? `${businessDescription} - Unmarked - ${invoiceNumber}`
        : `${businessDescription} - Unmarked`;
    }
    return businessDescription;
  }

  private formatVoucherType(value?: string): string {
    const voucherType = value?.trim();
    if (!voucherType) return '';

    switch (voucherType.toLowerCase()) {
      case 'cash':
        return 'Cash';
      case 'transfer':
      case 'bank transfer':
        return 'Transfer';
      case 'cheque':
      case 'check':
        return 'Cheque';
      default:
        return voucherType;
    }
  }
}
