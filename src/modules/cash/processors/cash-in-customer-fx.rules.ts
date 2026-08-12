import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CashInCustomerFxMatchedPair {
  debitLineNumber: number | string;
  customerLineNumber: number | string;
  debitLineId: string;
  customerLineId: string;
  debitLine: CashEntryRawDataModel;
  customerLine: CashEntryRawDataModel;
}

export interface CashInCustomerFxValidationError {
  field: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CashInCustomerFxSpecialCaseResult {
  uniqueId: string;
  matchedPairs: CashInCustomerFxMatchedPair[];
  consumedLineIds: Set<string>;
  skippedLedgerLineIds: Set<string>;
  residualLineIds: Set<string>;
  residualLines: CashEntryRawDataModel[];
  validationErrors: CashInCustomerFxValidationError[];
  isInvalid: boolean;
}

interface IndexedLine {
  line: CashEntryRawDataModel;
  id: string;
  index: number;
}

export function normalizeCashInAccountType(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function extractCashInMainAccount(
  accountDisplayValue?: string | null,
): string {
  return String(accountDisplayValue ?? '')
    .trim()
    .split('|')[0]
    .trim();
}

export function isCashInLedger421103Line(line: CashEntryRawDataModel): boolean {
  const accountType = normalizeCashInAccountType(line.ACCOUNTTYPE);
  const mainAccount = extractCashInMainAccount(line.ACCOUNTDISPLAYVALUE);
  return accountType === 'ledger' && mainAccount.startsWith('421103');
}

export function isCashInCustomerAccountType(value?: string | null): boolean {
  const normalized = normalizeCashInAccountType(value);
  return normalized === 'cust' || normalized === 'customer';
}

export function parseCashInCustomerInvoices(
  line: CashEntryRawDataModel,
): string[] {
  if (!isCashInCustomerAccountType(line.ACCOUNTTYPE) && !line.IsCustomer) {
    return [];
  }

  const value = String(line.INVOICE ?? '').trim();
  if (!value) return [];

  return value
    .split(',')
    .map((invoice) => invoice.trim())
    .filter((invoice) => invoice.length > 0);
}

export function cashInLineStableId(
  line: CashEntryRawDataModel,
  index: number,
): string {
  const uniqueId = String(line.UniqueId ?? '');
  const lineNumber = line.LINENUMBER;
  if (
    lineNumber !== undefined &&
    lineNumber !== null &&
    `${lineNumber}` !== ''
  ) {
    return `${uniqueId}:${lineNumber}`;
  }
  return `${uniqueId}:idx:${index}`;
}

function toPositiveNumber(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function normalizeCurrency(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function normalizeInvoiceToken(value: string): string {
  return value.trim().toLowerCase();
}

function invoicesOverlap(
  customerInvoices: string[],
  debitInvoice: string,
): boolean {
  if (customerInvoices.length === 0) return false;
  const debitTokens = String(debitInvoice ?? '')
    .split(',')
    .map((token) => normalizeInvoiceToken(token))
    .filter(Boolean);
  if (debitTokens.length === 0) return false;

  const customerTokens = new Set(
    customerInvoices.map((invoice) => normalizeInvoiceToken(invoice)),
  );
  return debitTokens.some((token) => customerTokens.has(token));
}

export function isCashInSpecialCustomerFxCase(
  lines: CashEntryRawDataModel[],
): boolean {
  // Detection uses any positive debit. Matching candidates still exclude
  // Ledger 421103 so its amount is never copied to the customer.
  const hasDebit = lines.some(
    (line) => toPositiveNumber(line.DEBITAMOUNT) !== null,
  );
  const hasCustomerCredit = lines.some(
    (line) =>
      (isCashInCustomerAccountType(line.ACCOUNTTYPE) || line.IsCustomer) &&
      toPositiveNumber(line.CREDITAMOUNT) !== null,
  );
  const hasLedger421103 = lines.some((line) => isCashInLedger421103Line(line));
  return hasDebit && hasCustomerCredit && hasLedger421103;
}

function collectDebitCandidates(lines: IndexedLine[]): IndexedLine[] {
  return lines.filter((entry) => {
    if (isCashInLedger421103Line(entry.line)) return false;
    if (toPositiveNumber(entry.line.DEBITAMOUNT) === null) return false;
    if (!normalizeCurrency(entry.line.CURRENCYCODE)) return false;
    return true;
  });
}

function collectCustomerCredits(lines: IndexedLine[]): IndexedLine[] {
  return lines.filter(
    (entry) =>
      (isCashInCustomerAccountType(entry.line.ACCOUNTTYPE) ||
        entry.line.IsCustomer) &&
      toPositiveNumber(entry.line.CREDITAMOUNT) !== null,
  );
}

function rankCandidatesForCustomer(
  customer: IndexedLine,
  debits: IndexedLine[],
): IndexedLine[] {
  let candidates = [...debits];
  const parsedInvoices = parseCashInCustomerInvoices(customer.line);

  if (parsedInvoices.length > 0) {
    const invoiceMatches = candidates.filter((debit) =>
      invoicesOverlap(parsedInvoices, String(debit.line.INVOICE ?? '')),
    );
    if (invoiceMatches.length > 0) {
      candidates = invoiceMatches;
    }
  }

  const customerCurrency = normalizeCurrency(customer.line.CURRENCYCODE);
  if (customerCurrency) {
    const currencyMatches = candidates.filter(
      (debit) =>
        normalizeCurrency(debit.line.CURRENCYCODE) === customerCurrency,
    );
    if (currencyMatches.length > 0) {
      candidates = currencyMatches;
    }
  }

  return candidates.sort((a, b) => {
    const aLine = Number(a.line.LINENUMBER ?? a.index);
    const bLine = Number(b.line.LINENUMBER ?? b.index);
    return aLine - bLine;
  });
}

function findAllPerfectMatchings(
  customers: IndexedLine[],
  candidateMap: Map<string, IndexedLine[]>,
): Array<Array<{ customer: IndexedLine; debit: IndexedLine }>> {
  const results: Array<Array<{ customer: IndexedLine; debit: IndexedLine }>> =
    [];

  const search = (
    customerIndex: number,
    usedDebitIds: Set<string>,
    current: Array<{ customer: IndexedLine; debit: IndexedLine }>,
  ): void => {
    if (customerIndex >= customers.length) {
      results.push([...current]);
      return;
    }

    // Cap exploration once ambiguity is proven.
    if (results.length > 1) return;

    const customer = customers[customerIndex];
    const candidates = candidateMap.get(customer.id) ?? [];
    for (const debit of candidates) {
      if (usedDebitIds.has(debit.id)) continue;
      usedDebitIds.add(debit.id);
      current.push({ customer, debit });
      search(customerIndex + 1, usedDebitIds, current);
      current.pop();
      usedDebitIds.delete(debit.id);
      if (results.length > 1) return;
    }
  };

  search(0, new Set(), []);
  return results;
}

function buildFailureDetails(
  uniqueId: string,
  customers: IndexedLine[],
  debits: IndexedLine[],
  reason: string,
): CashInCustomerFxValidationError {
  const voucher = customers[0]?.line.VOUCHER || debits[0]?.line.VOUCHER || '';
  const primaryCustomer = customers[0]?.line;

  return {
    field: 'CustomerDebitMatch',
    message:
      'Unable to determine a unique debit line for the customer Cash-In line.',
    details: {
      uniqueId,
      voucher,
      reason,
      customerLineNumber: primaryCustomer?.LINENUMBER,
      customerAccount: primaryCustomer?.ACCOUNTDISPLAYVALUE,
      customerCurrency: primaryCustomer?.CURRENCYCODE,
      parsedCustomerInvoices: primaryCustomer
        ? parseCashInCustomerInvoices(primaryCustomer)
        : [],
      candidateCustomerLines: customers.map((entry) => ({
        lineNumber: entry.line.LINENUMBER,
        account: entry.line.ACCOUNTDISPLAYVALUE,
        currency: entry.line.CURRENCYCODE,
        creditAmount: entry.line.CREDITAMOUNT,
        invoices: parseCashInCustomerInvoices(entry.line),
      })),
      candidateDebitLines: debits.map((entry) => ({
        lineNumber: entry.line.LINENUMBER,
        accountType: entry.line.ACCOUNTTYPE,
        currency: entry.line.CURRENCYCODE,
        debitAmount: entry.line.DEBITAMOUNT,
        invoice: entry.line.INVOICE,
      })),
    },
  };
}

export type CashInCustomerFxRateResolver = (
  transactionDate: string,
  currencyCode: string,
) => { exchangeRate: number; reportingRate: number };

export function evaluateCashInCustomerFxGroup(options: {
  uniqueId: string;
  lines: CashEntryRawDataModel[];
  resolveExchangeRate: CashInCustomerFxRateResolver;
}): {
  result: CashInCustomerFxSpecialCaseResult;
  outputLines: CashEntryRawDataModel[];
} {
  const { uniqueId, lines, resolveExchangeRate } = options;
  const indexed = lines.map((line, index) => ({
    line,
    index,
    id: cashInLineStableId(line, index),
  }));

  const emptyResult = (): CashInCustomerFxSpecialCaseResult => ({
    uniqueId,
    matchedPairs: [],
    consumedLineIds: new Set<string>(),
    skippedLedgerLineIds: new Set<string>(),
    residualLineIds: new Set<string>(indexed.map((entry) => entry.id)),
    residualLines: lines,
    validationErrors: [],
    isInvalid: false,
  });

  if (!isCashInSpecialCustomerFxCase(lines)) {
    return { result: emptyResult(), outputLines: lines };
  }

  const customers = collectCustomerCredits(indexed);
  const debits = collectDebitCandidates(indexed);
  const ledger421103 = indexed.filter((entry) =>
    isCashInLedger421103Line(entry.line),
  );

  const fail = (reason: string) => {
    const validationError = buildFailureDetails(
      uniqueId,
      customers,
      debits,
      reason,
    );
    return {
      result: {
        uniqueId,
        matchedPairs: [],
        consumedLineIds: new Set<string>(),
        skippedLedgerLineIds: new Set<string>(),
        residualLineIds: new Set<string>(),
        residualLines: [],
        validationErrors: [validationError],
        isInvalid: true,
      } satisfies CashInCustomerFxSpecialCaseResult,
      outputLines: lines,
    };
  };

  if (customers.length === 0) {
    return fail('No valid customer credit lines found.');
  }
  if (debits.length === 0) {
    return fail(
      'No matching debit line was found for the customer Cash-In line.',
    );
  }

  // Sort customers deterministically by line number before assignment search.
  const orderedCustomers = [...customers].sort((a, b) => {
    const aLine = Number(a.line.LINENUMBER ?? a.index);
    const bLine = Number(b.line.LINENUMBER ?? b.index);
    return aLine - bLine;
  });

  const candidateMap = new Map<string, IndexedLine[]>();
  for (const customer of orderedCustomers) {
    const ranked = rankCandidatesForCustomer(customer, debits);
    if (ranked.length === 0) {
      return fail(
        `No matching debit line was found for customer line ${customer.line.LINENUMBER}.`,
      );
    }
    candidateMap.set(customer.id, ranked);
  }

  const matchings = findAllPerfectMatchings(orderedCustomers, candidateMap);
  if (matchings.length === 0) {
    return fail(
      'No matching debit line was found for the customer Cash-In line.',
    );
  }
  if (matchings.length > 1) {
    return fail(
      'More than one valid debit/customer assignment remains after matching.',
    );
  }

  const matching = matchings[0];

  // Validate all pairs (including FX) before mutating any customer line.
  const pendingTransforms: Array<{
    customer: IndexedLine;
    debit: IndexedLine;
    debitAmount: number;
    debitCurrency: string;
    originalCreditAmount: unknown;
    originalCurrency: string;
    exchangeRate?: number;
  }> = [];

  for (const { customer, debit } of matching) {
    const debitAmount = toPositiveNumber(debit.line.DEBITAMOUNT);
    const debitCurrency = normalizeCurrency(debit.line.CURRENCYCODE);

    if (debitAmount === null) {
      return fail(
        `The matched debit line contains an invalid debit amount (line ${debit.line.LINENUMBER}).`,
      );
    }
    if (!debitCurrency) {
      return fail(
        `The matched debit line does not contain a currency code (line ${debit.line.LINENUMBER}).`,
      );
    }

    const originalCurrency = normalizeCurrency(customer.line.CURRENCYCODE);
    let exchangeRate: number | undefined;

    if (originalCurrency !== debitCurrency) {
      const transactionDate = String(
        customer.line.TRANSDATE ||
          debit.line.TRANSDATE ||
          lines.find((line) => String(line.TRANSDATE ?? '').trim())
            ?.TRANSDATE ||
          '',
      ).trim();

      if (!transactionDate) {
        return fail(
          'No valid exchange rate was found for the transformed customer Cash-In line.',
        );
      }

      try {
        const rates = resolveExchangeRate(transactionDate, debitCurrency);
        if (!Number.isFinite(rates.exchangeRate) || rates.exchangeRate <= 0) {
          return fail(
            'No valid exchange rate was found for the transformed customer Cash-In line.',
          );
        }
        exchangeRate = rates.exchangeRate;
      } catch {
        return fail(
          'No valid exchange rate was found for the transformed customer Cash-In line.',
        );
      }
    }

    pendingTransforms.push({
      customer,
      debit,
      debitAmount,
      debitCurrency,
      originalCreditAmount: customer.line.CREDITAMOUNT,
      originalCurrency,
      exchangeRate,
    });
  }

  const matchedPairs: CashInCustomerFxMatchedPair[] = [];
  const consumedLineIds = new Set<string>();

  for (const pending of pendingTransforms) {
    const { customer, debit, debitAmount, debitCurrency } = pending;
    const originalInvoice = customer.line.INVOICE;

    customer.line.DEBITAMOUNT = 0;
    customer.line.CREDITAMOUNT = debitAmount;
    customer.line.CURRENCYCODE = debit.line.CURRENCYCODE;
    if (pending.exchangeRate !== undefined) {
      customer.line.EXCHANGERATE = pending.exchangeRate;
    }
    customer.line.INVOICE = originalInvoice;

    matchedPairs.push({
      debitLineNumber: debit.line.LINENUMBER,
      customerLineNumber: customer.line.LINENUMBER,
      debitLineId: debit.id,
      customerLineId: customer.id,
      debitLine: debit.line,
      customerLine: customer.line,
    });
    consumedLineIds.add(customer.id);
    consumedLineIds.add(debit.id);

    (customer.line as any).__cashInFxTransform = {
      originalCreditAmount: pending.originalCreditAmount,
      originalCurrency: pending.originalCurrency,
      updatedCreditAmount: debitAmount,
      updatedCurrency: debitCurrency,
      sourceDebitLineNumber: debit.line.LINENUMBER,
      parsedInvoices: parseCashInCustomerInvoices(customer.line),
    };
  }

  const skippedLedgerLineIds = new Set<string>(
    ledger421103.map((entry) => entry.id),
  );
  const residualEntries = indexed.filter(
    (entry) =>
      !consumedLineIds.has(entry.id) && !skippedLedgerLineIds.has(entry.id),
  );
  const residualLineIds = new Set<string>(
    residualEntries.map((entry) => entry.id),
  );
  const residualLines = residualEntries.map((entry) => entry.line);

  const outputLines = indexed
    .filter((entry) => !skippedLedgerLineIds.has(entry.id))
    .map((entry) => entry.line);

  return {
    result: {
      uniqueId,
      matchedPairs,
      consumedLineIds,
      skippedLedgerLineIds,
      residualLineIds,
      residualLines,
      validationErrors: [],
      isInvalid: false,
    },
    outputLines,
  };
}
