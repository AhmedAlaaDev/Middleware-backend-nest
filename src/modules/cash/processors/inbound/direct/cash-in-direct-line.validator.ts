import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { cashPaymentReferenceLengthErrorMessage } from '@/modules/cash/policies/cash-payment-reference.policy';

export function collectCashInDirectSourceErrors(
  row: CashEntryRawDataModel,
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const lineContext = `Line ${row.LINENUMBER || '?'} (UniqueId ${row.UniqueId || '?'})`;

  if (!row.IsCustomer) {
    errors.push({
      field: 'AccountType',
      message: `${lineContext}: ACCOUNTTYPE must be Cust.`,
    });
  }

  if (!String(row.ACCOUNTDISPLAYVALUE ?? '').trim()) {
    errors.push({
      field: 'AccountDisplayValue',
      message: `${lineContext}: customer ACCOUNTDISPLAYVALUE is required.`,
    });
  }

  if (!String(row.OFFSETACCOUNTTYPE ?? '').trim()) {
    errors.push({
      field: 'OffsetAccountType',
      message: `${lineContext}: OFFSETACCOUNTTYPE is required.`,
    });
  }

  if (!String(row.OFFSETACCOUNTDISPLAYVALUE ?? '').trim()) {
    errors.push({
      field: 'OffsetAccountDisplayValue',
      message: `${lineContext}: OFFSETACCOUNTDISPLAYVALUE is required.`,
    });
  }

  if (!String(row.CURRENCYCODE ?? '').trim()) {
    errors.push({
      field: 'CurrencyCode',
      message: `${lineContext}: CURRENCYCODE is required.`,
    });
  }

  if (!String(row.TRANSDATE ?? '').trim()) {
    errors.push({
      field: 'TransactionDate',
      message: `${lineContext}: TRANSDATE is required.`,
    });
  }

  if (!String(row.INVOICE ?? '').trim()) {
    errors.push({
      field: 'Invoice',
      message: `${lineContext}: INVOICE is required for customer settlement.`,
    });
  }

  if (!row.IsCustomerCollection && !row.IsDownPayment) {
    errors.push({
      field: 'SafeType',
      message: `${lineContext}: SafeType must be Customer Collection or DownPayment.`,
    });
  }

  const paymentReferenceError = cashPaymentReferenceLengthErrorMessage({
    paymentReference: row.PAYMENTREFERENCE,
    lineNumber: row.LINENUMBER,
    uniqueId: row.UniqueId,
  });
  if (paymentReferenceError) {
    errors.push({
      field: 'PaymentReference',
      message: paymentReferenceError,
    });
  }

  return errors;
}
