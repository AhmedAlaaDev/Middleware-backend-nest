import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

/**
 * Cash-Out DownPayment, CN, and Customer Collection bank rows post to Cust-Pay
 * as AR customer-payment lines. The bank account belongs on the customer
 * offset, not as a second offsetless journal line.
 *
 * Petty-cash pairs are not collapsed here. Those are Custody Settlement
 * two-line journals; putting RCash on a Cust-Pay offset creates a finance
 * difference.
 */
export function applyCashOutCustomerPaymentOffset(
  lines: CashEntryRawDataModel[],
): CashEntryRawDataModel[] {
  if (isCashOutCustomerPettyCashSettlement(lines)) {
    return lines;
  }
  if (lines.length !== 2 || !lines.every(isCashOutCustomerPaymentLine)) {
    return lines;
  }

  const customerLine = lines.find(isCustomerAccountLine);
  const cashLine = lines.find(isBankLine);
  if (!customerLine || !cashLine || customerLine === cashLine) {
    return lines;
  }

  if (!firstNonEmpty(customerLine.OFFSETACCOUNTDISPLAYVALUE)) {
    customerLine.OFFSETACCOUNTDISPLAYVALUE = firstNonEmpty(
      cashLine.ACCOUNTDISPLAYVALUE,
    );
  }

  if (!firstNonEmpty(customerLine.OFFSETACCOUNTTYPE)) {
    customerLine.OFFSETACCOUNTTYPE = cashLine.ACCOUNTTYPE;
  }

  if (!firstNonEmpty(customerLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE)) {
    customerLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = firstNonEmpty(
      cashLine.OFFSETDEFAULTDIMENSIONDISPLAYVALUE,
      cashLine.DEFAULTDIMENSIONDISPLAYVALUE,
    );
  }

  if (!firstNonEmpty(customerLine.OFFSETFINTAGDISPLAYVALUE)) {
    customerLine.OFFSETFINTAGDISPLAYVALUE = firstNonEmpty(
      cashLine.OFFSETFINTAGDISPLAYVALUE,
      cashLine.FINTAGDISPLAYVALUE,
    );
  }

  if (!firstNonEmpty(customerLine.OFFSETTEXT)) {
    customerLine.OFFSETTEXT = firstNonEmpty(
      cashLine.OFFSETTEXT,
      cashLine.TEXT,
      cashLine.DESCRIPTION,
    );
  }

  return [customerLine];
}

/**
 * Cash-Out customer debit + petty-cash credit is a Custody Settlement, even
 * when Excel labelled the rows DownPayment. Keep both lines and clear any
 * invented Cust-Pay offset.
 */
export function retargetCashOutCustomerPettyCashToCustodySettlement(
  lines: CashEntryRawDataModel[],
): boolean {
  if (!isCashOutCustomerPettyCashSettlement(lines)) return false;

  for (const line of lines) {
    line.SafeType = 'Custody Settlement';
    line.IsCustodySettlement = true;
  }
  return true;
}

export function isCashOutCustomerPettyCashSettlement(
  lines: CashEntryRawDataModel[],
): boolean {
  if (lines.length !== 2 || !lines.every(isCashOutCustomerPaymentLine)) {
    return false;
  }

  const customerLine = lines.find(isCustomerAccountLine);
  const pettyCashLine = lines.find(isPettyCashLine);
  if (!customerLine || !pettyCashLine || customerLine === pettyCashLine) {
    return false;
  }

  return (
    Number(customerLine.DEBITAMOUNT ?? 0) > 0 &&
    Number(pettyCashLine.CREDITAMOUNT ?? 0) > 0
  );
}

function isCashOutCustomerPaymentLine(line: CashEntryRawDataModel): boolean {
  const token = String(line.SafeType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return (
    token === 'downpayment' || token === 'cn' || token === 'customercollection'
  );
}

function isCustomerAccountLine(line: CashEntryRawDataModel): boolean {
  return line.IsCustomer || normalizeAccountType(line.ACCOUNTTYPE) === 'cust';
}

function isPettyCashLine(line: CashEntryRawDataModel): boolean {
  if (line.IsPettyCash) return true;
  const accountType = normalizeAccountType(line.ACCOUNTTYPE);
  return accountType === 'pettycash' || accountType === 'rcash';
}

function isBankLine(line: CashEntryRawDataModel): boolean {
  if (line.IsBank) return true;
  return normalizeAccountType(line.ACCOUNTTYPE) === 'bank';
}

function normalizeAccountType(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}
