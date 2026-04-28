import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';

type RiskFlagKey =
  | 'hasSettlementLines'
  | 'hasMixedCurrencies'
  | 'hasMultipleCustomers'
  | 'hasMultipleInvoices'
  | 'hasLedgerOffset'
  | 'hasNotesReceivable'
  | 'cartesianProductRiskInCurrentProcessor';

type BusinessUseCaseClassification = {
  safeType: string;
  voucherType: string;
  offsetMultiplicityPattern: string;
  offsetCategoryPattern: string;
  currencyPattern: string;
  settlementPattern: string;
  notesReceivablePattern: string;
  sourceBalancePattern: string;
  amountBehaviorPattern: string;
};

type ClassifiedRow = {
  lineNumber: number;
  safeType: string;
  voucherType: string;
  accountType: string;
  accountDisplayValue: string;
  mainAccount: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  currencyCode: string;
  exchangeRate: number;
  invoice: string;
  paymentReference: string;
  isCustomerLine: boolean;
  isOffsetLine: boolean;
  isLedgerLine: boolean;
  isSettlementLine: boolean;
  settlementMainAccount?: '421103';
  isNotesReceivableLine: boolean;
  ledgerCategory:
    | 'LEDGER_SETTLEMENT_421103'
    | 'LEDGER_NOTES_RECEIVABLE'
    | 'LEDGER_OTHER'
    | 'NON_LEDGER';
};

type Example = {
  uniqueId: number;
  sourceRows: ClassifiedRow[];
  totals: { debit: number; credit: number };
  truncated: boolean;
  totalRowsInGroup: number;
};

type Classification = {
  safeType: string;
  voucherType: string;
  lineCountBucket: string;
  accountTypeCompositionBucket: string;
  customerLinePattern: string;
  offsetLinePattern: string;
  settlementPattern: string;
  notesReceivablePattern: string;
  currencyPattern: string;
  invoicePattern: string;
  amountDirectionPattern: string;
  currentProcessorBehaviorPattern: string;
};

type GroupAnalysis = {
  uniqueId: number;
  safeType: string;
  voucherType: string;
  lineCount: number;
  rows: ClassifiedRow[];
  example: Example;
  businessClassification: BusinessUseCaseClassification;
  classification: Classification;
  mainSignature: string;
  variantSignature: string;
  title: string;
  riskFlags: {
    hasMoreThanTwoLines: boolean;
    hasSettlementLines: boolean;
    hasMixedCurrencies: boolean;
    hasMultipleCustomers: boolean;
    hasMultipleCustomerLines: boolean;
    hasMultipleInvoices: boolean;
    hasLedgerOffset: boolean;
    hasNotesReceivable: boolean;
    cartesianProductRiskInCurrentProcessor: boolean;
  };
  variantDetails: {
    exactLineCount: number;
    accountTypeComposition: Record<string, number>;
    customerLines: number;
    offsetLines: number;
    ledgerLines: number;
    settlementLines: number;
    notesReceivableLines: number;
    offsetAccountTypes: string[];
    ledgerMainAccounts: string[];
    notesReceivableMainAccounts: string[];
    currencies: string[];
    isBalancedInSource: boolean;
  };
  currentProcessorBehavior: {
    removesSettlementLinesBeforeMapping: true;
    lineCountAfterSettlementRemovalPattern: string;
    expectedGeneratedLineCountFormula: string;
    hasCartesianProductRisk: boolean;
    notes: string[];
  };
};

type Variant = {
  variantId: string;
  variantSignature: string;
  frequency: number;
  exampleUniqueIds: number[];
  details: GroupAnalysis['variantDetails'];
  examples: Example[];
};

type MainUseCase = {
  useCaseId: string;
  title: string;
  mainSignature: string;
  frequency: number;
  variantCount: number;
  exampleUniqueIds: number[];
  businessClassification: BusinessUseCaseClassification;
  classification: Classification;
  riskFlags: GroupAnalysis['riskFlags'];
  variants: Variant[];
  currentProcessorBehavior: GroupAnalysis['currentProcessorBehavior'];
  businessReview: {
    accountingDecision: string;
    requiredDfoAccount: string;
    requiredDfoOffset: string;
    creditAmountRule: string;
    currencyExchangeRule: string;
    settlementFxHandling: string;
    markedInvoiceRule: string;
    notes: string;
    approvedBy: string;
    approvedDate: string;
  };
};

const INCLUDED_SAFE_TYPES = new Set(['Customer Collection', 'DownPayment']);
const NOTES_RECEIVABLE_MAIN_ACCOUNTS = new Set([
  '122201',
  '122202',
  '122203',
  '122204',
  '123510',
]);
const SETTLEMENT_MAIN_ACCOUNT = '421103';
const DEFAULT_INPUT = 'excel-sources/Cash/Safe In_01_26_Freight - Copy.xlsx';
const DEFAULT_OUTPUT = 'analysis/cash-in-use-cases.json';
const ACCOUNT_TYPE_ORDER = ['Cust', 'Bank', 'Petty cash', 'Ledger', 'Vend'];

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return String(v).trim();
  }
  if (typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    const result = (v as Record<string, unknown>).result;
    return normalizeText(result);
  }
  return '';
}

function normalizeCurrency(v: unknown): string {
  return normalizeText(v).toUpperCase();
}

function normalizeAccountType(v: unknown): string {
  const value = normalizeText(v);
  const lower = value.toLowerCase();
  if (lower === 'cust') return 'Cust';
  if (lower === 'ledger') return 'Ledger';
  if (lower === 'bank') return 'Bank';
  if (lower === 'petty cash') return 'Petty cash';
  if (lower === 'vend') return 'Vend';
  return value;
}

function addCount(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] || 0) + by;
}

function toFixed2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function bucketCount(value: number): string {
  return value > 5 ? 'MANY' : String(value);
}

function buildLineCountBucket(lineCount: number): string {
  if (lineCount <= 5) return `${lineCount}_LINES`;
  if (lineCount <= 10) return 'MANY_LINES_6_TO_10';
  if (lineCount <= 50) return 'MANY_LINES_11_TO_50';
  return 'MANY_LINES_51_PLUS';
}

function buildAccountTypeCompositionBucket(
  composition: Record<string, number>,
): string {
  return ACCOUNT_TYPE_ORDER.map((accountType) => ({
    accountType,
    count: composition[accountType] || 0,
  }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.accountType}:${bucketCount(item.count)}`)
    .join('+');
}

function parseMainAccount(
  utilsService: EntryProcessorUtilsService,
  accountDisplayValue: string,
): string {
  return (
    utilsService.parseDimensionString(accountDisplayValue).mainAccount || ''
  );
}

function classifyRow(
  line: CashEntryRawDataModel,
  utilsService: EntryProcessorUtilsService,
): ClassifiedRow {
  const accountType = normalizeAccountType(line.ACCOUNTTYPE);
  const mainAccount = parseMainAccount(utilsService, line.ACCOUNTDISPLAYVALUE);
  const isCustomerLine = accountType === 'Cust';
  const isLedgerLine = accountType === 'Ledger';
  const isSettlementLine =
    isLedgerLine && mainAccount === SETTLEMENT_MAIN_ACCOUNT;
  const isNotesReceivableLine =
    isLedgerLine && NOTES_RECEIVABLE_MAIN_ACCOUNTS.has(mainAccount);

  let ledgerCategory: ClassifiedRow['ledgerCategory'] = 'NON_LEDGER';
  if (isSettlementLine) {
    ledgerCategory = 'LEDGER_SETTLEMENT_421103';
  } else if (isNotesReceivableLine) {
    ledgerCategory = 'LEDGER_NOTES_RECEIVABLE';
  } else if (isLedgerLine) {
    ledgerCategory = 'LEDGER_OTHER';
  }

  return {
    lineNumber: Number(line.LINENUMBER || 0),
    safeType: normalizeText(line.SafeType),
    voucherType: normalizeText(line.VoucherType),
    accountType,
    accountDisplayValue: normalizeText(line.ACCOUNTDISPLAYVALUE),
    mainAccount,
    description: normalizeText(line.DESCRIPTION),
    debitAmount: Number(line.DEBITAMOUNT || 0),
    creditAmount: Number(line.CREDITAMOUNT || 0),
    currencyCode: normalizeCurrency(line.CURRENCYCODE),
    exchangeRate: Number(line.EXCHANGERATE || 0),
    invoice: normalizeText(line.INVOICE),
    paymentReference: normalizeText(line.PAYMENTREFERENCE),
    isCustomerLine,
    isOffsetLine: !isCustomerLine,
    isLedgerLine,
    isSettlementLine,
    ...(isSettlementLine ? { settlementMainAccount: '421103' as const } : {}),
    isNotesReceivableLine,
    ledgerCategory,
  };
}

function buildExample(uniqueId: number, rows: ClassifiedRow[]): Example {
  return {
    uniqueId,
    sourceRows: rows.slice(0, 10),
    totals: {
      debit: toFixed2(rows.reduce((sum, row) => sum + row.debitAmount, 0)),
      credit: toFixed2(rows.reduce((sum, row) => sum + row.creditAmount, 0)),
    },
    truncated: rows.length > 10,
    totalRowsInGroup: rows.length,
  };
}

function buildTitle(bc: BusinessUseCaseClassification): string {
  const fmt = (s: string) =>
    s
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return [
    bc.safeType,
    bc.voucherType,
    fmt(bc.offsetCategoryPattern),
    fmt(bc.offsetMultiplicityPattern),
    fmt(bc.currencyPattern),
    bc.settlementPattern !== 'NO_SETTLEMENT' ? fmt(bc.settlementPattern) : '',
    bc.notesReceivablePattern !== 'NO_NOTES_RECEIVABLE'
      ? 'Notes Receivable'
      : '',
    bc.amountBehaviorPattern !== 'NORMAL_CASH_IN' &&
    bc.amountBehaviorPattern !== 'NORMAL_CASH_IN_WITH_SETTLEMENT'
      ? fmt(bc.amountBehaviorPattern)
      : '',
  ]
    .filter(Boolean)
    .join(' / ');
}

function buildBusinessUseCaseClassification(
  rows: ClassifiedRow[],
  derived: {
    safeType: string;
    voucherType: string;
    settlementLines: number;
    notesReceivableLines: number;
    hasMixedCurrencies: boolean;
    customerOffsetCurrencyMismatch: boolean;
    isBalancedInSource: boolean;
    customerCredit: number;
    customerDebit: number;
  },
): BusinessUseCaseClassification {
  // Multiplicity and category are based on non-settlement offset lines only.
  // Settlement lines are captured separately via settlementPattern.
  const nonSettlementOffsets = rows.filter(
    (r) => r.isOffsetLine && !r.isSettlementLine,
  );
  const nonSettlementOffsetCount = nonSettlementOffsets.length;

  const offsetMultiplicityPattern =
    nonSettlementOffsetCount === 0
      ? 'NO_OFFSET'
      : nonSettlementOffsetCount === 1
        ? 'SINGLE_OFFSET'
        : 'MULTI_OFFSET';

  let offsetCategoryPattern: string;
  if (nonSettlementOffsetCount === 0) {
    offsetCategoryPattern = 'NO_OFFSET';
  } else {
    const categories = [
      ...new Set(
        nonSettlementOffsets.map((r) => {
          if (r.accountType === 'Bank') return 'BANK';
          if (r.accountType === 'Petty cash') return 'PETTY_CASH';
          if (r.accountType === 'Vend') return 'VEND';
          if (r.isLedgerLine) return r.ledgerCategory; // LEDGER_NOTES_RECEIVABLE | LEDGER_OTHER
          return 'OTHER';
        }),
      ),
    ];
    offsetCategoryPattern =
      categories.length === 1 ? categories[0] : 'MIXED_OFFSET_CATEGORIES';
  }

  const hasMixed =
    derived.hasMixedCurrencies || derived.customerOffsetCurrencyMismatch;
  const currencyPattern = hasMixed ? 'MIXED_CURRENCY' : 'SINGLE_CURRENCY';

  const settlementPattern =
    derived.settlementLines > 0 ? 'HAS_SETTLEMENT_421103' : 'NO_SETTLEMENT';

  const notesReceivablePattern =
    derived.notesReceivableLines > 0
      ? 'HAS_NOTES_RECEIVABLE'
      : 'NO_NOTES_RECEIVABLE';

  const sourceBalancePattern = derived.isBalancedInSource
    ? 'BALANCED_SOURCE'
    : 'UNBALANCED_SOURCE';

  // Amount behavior: check direction using non-settlement offsets so settlement
  // lines don't distort the normal cash-in pattern.
  const nsOffsetDebit = nonSettlementOffsets.reduce(
    (s, r) => s + r.debitAmount,
    0,
  );
  const nsOffsetCredit = nonSettlementOffsets.reduce(
    (s, r) => s + r.creditAmount,
    0,
  );
  const isNormalDirection =
    derived.customerCredit > 0 &&
    derived.customerDebit === 0 &&
    nsOffsetDebit > 0 &&
    nsOffsetCredit === 0;

  let amountBehaviorPattern: string;
  if (isNormalDirection && derived.settlementLines > 0) {
    amountBehaviorPattern = 'NORMAL_CASH_IN_WITH_SETTLEMENT';
  } else if (isNormalDirection) {
    amountBehaviorPattern = 'NORMAL_CASH_IN';
  } else {
    amountBehaviorPattern = 'UNUSUAL_AMOUNT_BEHAVIOR';
  }

  return {
    safeType: derived.safeType,
    voucherType: derived.voucherType,
    offsetMultiplicityPattern,
    offsetCategoryPattern,
    currencyPattern,
    settlementPattern,
    notesReceivablePattern,
    sourceBalancePattern,
    amountBehaviorPattern,
  };
}

function classifyGroup(
  rows: ClassifiedRow[],
): Omit<
  GroupAnalysis,
  | 'uniqueId'
  | 'safeType'
  | 'voucherType'
  | 'rows'
  | 'example'
  | 'mainSignature'
  | 'variantSignature'
  | 'title'
> {
  const lineCount = rows.length;
  const composition: Record<string, number> = {
    Cust: 0,
    Bank: 0,
    'Petty cash': 0,
    Ledger: 0,
    Vend: 0,
  };
  const currencies = uniqueSorted(rows.map((row) => row.currencyCode));
  const customerCurrencies = uniqueSorted(
    rows.filter((row) => row.isCustomerLine).map((row) => row.currencyCode),
  );
  const offsetCurrencies = uniqueSorted(
    rows.filter((row) => row.isOffsetLine).map((row) => row.currencyCode),
  );
  const invoices = uniqueSorted(rows.map((row) => row.invoice).filter(Boolean));
  const customerAccounts = uniqueSorted(
    rows
      .filter((row) => row.isCustomerLine)
      .map((row) => row.accountDisplayValue)
      .filter(Boolean),
  );
  const ledgerMainAccounts = uniqueSorted(
    rows
      .filter((row) => row.isLedgerLine)
      .map((row) => row.mainAccount)
      .filter(Boolean),
  );
  const notesReceivableMainAccounts = uniqueSorted(
    rows
      .filter((row) => row.isNotesReceivableLine)
      .map((row) => row.mainAccount)
      .filter(Boolean),
  );
  const offsetAccountTypes = uniqueSorted(
    rows.filter((row) => row.isOffsetLine).map((row) => row.accountType),
  );

  let customerLines = 0;
  let offsetLines = 0;
  let ledgerLines = 0;
  let settlementLines = 0;
  let notesReceivableLines = 0;
  let customerDebit = 0;
  let customerCredit = 0;
  let offsetDebit = 0;
  let offsetCredit = 0;
  let settlementDebit = 0;
  let settlementCredit = 0;
  let totalDebit = 0;
  let totalCredit = 0;

  for (const row of rows) {
    composition[row.accountType] = (composition[row.accountType] || 0) + 1;
    totalDebit += row.debitAmount;
    totalCredit += row.creditAmount;

    if (row.isCustomerLine) {
      customerLines++;
      customerDebit += row.debitAmount;
      customerCredit += row.creditAmount;
    } else {
      offsetLines++;
      offsetDebit += row.debitAmount;
      offsetCredit += row.creditAmount;
    }

    if (row.isLedgerLine) ledgerLines++;
    if (row.isSettlementLine) {
      settlementLines++;
      settlementDebit += row.debitAmount;
      settlementCredit += row.creditAmount;
    }
    if (row.isNotesReceivableLine) notesReceivableLines++;
  }

  const hasMixedCurrencies = currencies.length > 1;
  const customerOffsetCurrencyMismatch =
    customerCurrencies.length > 0 &&
    offsetCurrencies.length > 0 &&
    JSON.stringify(customerCurrencies) !== JSON.stringify(offsetCurrencies);
  const isBalancedInSource = Math.abs(totalDebit - totalCredit) <= 0.01;
  const hasZeroAmountPresent = rows.some(
    (row) => row.debitAmount === 0 || row.creditAmount === 0,
  );

  const settlementPattern =
    settlementLines === 0
      ? 'NO_SETTLEMENT'
      : settlementDebit > 0 && settlementCredit > 0
        ? 'HAS_SETTLEMENT_421103_BOTH'
        : settlementDebit > 0
          ? 'HAS_SETTLEMENT_421103_DEBIT'
          : settlementCredit > 0
            ? 'HAS_SETTLEMENT_421103_CREDIT'
            : 'HAS_SETTLEMENT_421103_ZERO';

  const notesReceivablePattern =
    notesReceivableLines > 0 ? 'HAS_NOTES_RECEIVABLE' : 'NO_NOTES_RECEIVABLE';

  let currencyPattern = 'SINGLE_CURRENCY';
  if (customerOffsetCurrencyMismatch) {
    currencyPattern = 'CUSTOMER_OFFSET_CURRENCY_MISMATCH';
  } else if (hasMixedCurrencies) {
    currencyPattern = 'MIXED_CURRENCY';
  }

  const invoicePattern =
    invoices.length === 0
      ? 'NO_INVOICE'
      : invoices.length === 1
        ? 'SINGLE_INVOICE'
        : 'MULTI_INVOICE';

  let amountDirectionPattern = 'MIXED_AMOUNT_DIRECTIONS';
  if (!isBalancedInSource) {
    amountDirectionPattern = 'UNBALANCED_SOURCE';
  } else if (settlementLines > 0) {
    amountDirectionPattern = 'CUSTOMER_CREDIT_WITH_SETTLEMENT';
  } else if (hasZeroAmountPresent) {
    amountDirectionPattern = 'ZERO_AMOUNT_PRESENT';
  } else if (
    customerCredit > 0 &&
    customerDebit === 0 &&
    offsetDebit > 0 &&
    offsetCredit === 0
  ) {
    amountDirectionPattern = 'CUSTOMER_CREDIT_OFFSET_DEBIT';
  } else if (
    customerDebit > 0 &&
    customerCredit === 0 &&
    offsetCredit > 0 &&
    offsetDebit === 0
  ) {
    amountDirectionPattern = 'CUSTOMER_DEBIT_OFFSET_CREDIT';
  }

  const offsetPatternParts = [
    offsetAccountTypes.includes('Bank') ? 'BANK' : '',
    offsetAccountTypes.includes('Petty cash') ? 'PETTY_CASH' : '',
    offsetAccountTypes.includes('Vend') ? 'VEND' : '',
    offsetAccountTypes.includes('Ledger')
      ? uniqueSorted(
          rows
            .filter((row) => row.isOffsetLine && row.isLedgerLine)
            .map((row) => row.ledgerCategory),
        ).join('_AND_')
      : '',
  ].filter(Boolean);

  let offsetLinePattern = 'NO_OFFSET_LINE';
  if (offsetPatternParts.length === 1) {
    const [part] = offsetPatternParts;
    if (part === 'BANK') offsetLinePattern = 'BANK_ONLY';
    else if (part === 'PETTY_CASH') offsetLinePattern = 'PETTY_CASH_ONLY';
    else if (part.startsWith('LEDGER_')) offsetLinePattern = 'LEDGER_ONLY';
    else offsetLinePattern = `${part}_ONLY`;
  } else if (offsetPatternParts.length === 2) {
    if (
      offsetPatternParts.includes('BANK') &&
      offsetPatternParts.some((p) => p.startsWith('LEDGER_'))
    ) {
      offsetLinePattern = 'BANK_AND_LEDGER';
    } else if (
      offsetPatternParts.includes('PETTY_CASH') &&
      offsetPatternParts.some((p) => p.startsWith('LEDGER_'))
    ) {
      offsetLinePattern = 'PETTY_CASH_AND_LEDGER';
    } else {
      offsetLinePattern = 'MULTI_OFFSET_TYPES';
    }
  } else if (offsetPatternParts.length > 2) {
    offsetLinePattern = 'MULTI_OFFSET_TYPES';
  }

  const withoutSettlement = rows.filter((row) => !row.isSettlementLine);
  const customerLinesAfterSettlement = withoutSettlement.filter(
    (row) => row.isCustomerLine,
  ).length;
  const offsetLinesAfterSettlement = withoutSettlement.filter(
    (row) => row.isOffsetLine,
  ).length;
  const cartesianRisk =
    customerLinesAfterSettlement > 1 && offsetLinesAfterSettlement > 1;

  let currentProcessorBehaviorPattern = 'CASE_TWO_LINES';
  if (lineCount !== 2) {
    if (customerLinesAfterSettlement <= 1 && offsetLinesAfterSettlement <= 1) {
      currentProcessorBehaviorPattern =
        'CASE_MORE_THAN_TWO_LINES_SINGLE_CUSTOMER_SINGLE_OFFSET';
    } else if (
      customerLinesAfterSettlement > 1 &&
      offsetLinesAfterSettlement <= 1
    ) {
      currentProcessorBehaviorPattern =
        'CASE_MORE_THAN_TWO_LINES_MULTI_CUSTOMER_SINGLE_OFFSET';
    } else if (
      customerLinesAfterSettlement <= 1 &&
      offsetLinesAfterSettlement > 1
    ) {
      currentProcessorBehaviorPattern =
        'CASE_MORE_THAN_TWO_LINES_SINGLE_CUSTOMER_MULTI_OFFSET';
    } else {
      currentProcessorBehaviorPattern =
        'CASE_MORE_THAN_TWO_LINES_MULTI_CUSTOMER_MULTI_OFFSET_CARTESIAN_RISK';
    }
  }

  const classification: Classification = {
    safeType: rows[0]?.safeType || '',
    voucherType: rows[0]?.voucherType || '',
    lineCountBucket: buildLineCountBucket(lineCount),
    accountTypeCompositionBucket:
      buildAccountTypeCompositionBucket(composition),
    customerLinePattern:
      customerLines === 0
        ? 'NO_CUSTOMER_LINE'
        : customerLines === 1
          ? 'ONE_CUSTOMER_LINE'
          : 'MULTI_CUSTOMER_LINES',
    offsetLinePattern,
    settlementPattern,
    notesReceivablePattern,
    currencyPattern,
    invoicePattern,
    amountDirectionPattern,
    currentProcessorBehaviorPattern,
  };

  const riskFlags = {
    hasMoreThanTwoLines: lineCount > 2,
    hasSettlementLines: settlementLines > 0,
    hasMixedCurrencies: hasMixedCurrencies || customerOffsetCurrencyMismatch,
    hasMultipleCustomers: customerAccounts.length > 1,
    hasMultipleCustomerLines: customerLines > 1,
    hasMultipleInvoices: invoices.length > 1,
    hasLedgerOffset: ledgerLines > 0,
    hasNotesReceivable: notesReceivableLines > 0,
    cartesianProductRiskInCurrentProcessor: cartesianRisk,
  };

  const businessClassification = buildBusinessUseCaseClassification(rows, {
    safeType: rows[0]?.safeType || '',
    voucherType: rows[0]?.voucherType || '',
    settlementLines,
    notesReceivableLines,
    hasMixedCurrencies,
    customerOffsetCurrencyMismatch,
    isBalancedInSource,
    customerCredit,
    customerDebit,
  });

  return {
    lineCount,
    businessClassification,
    classification,
    riskFlags,
    variantDetails: {
      exactLineCount: lineCount,
      accountTypeComposition: composition,
      customerLines,
      offsetLines,
      ledgerLines,
      settlementLines,
      notesReceivableLines,
      offsetAccountTypes,
      ledgerMainAccounts,
      notesReceivableMainAccounts,
      currencies,
      isBalancedInSource,
    },
    currentProcessorBehavior: {
      removesSettlementLinesBeforeMapping: true,
      lineCountAfterSettlementRemovalPattern: buildLineCountBucket(
        withoutSettlement.length,
      ),
      expectedGeneratedLineCountFormula:
        'customerLinesAfterSettlement * offsetLinesAfterSettlement',
      hasCartesianProductRisk: cartesianRisk,
      notes: [
        'Current processor removes settlement lines (Ledger main account 421103) before mapping in caseMoreThanTwoLines.',
        'This analysis keeps settlement lines in examples and normalized classification.',
      ],
    },
  };
}

function buildMainUseCaseSignature(bc: BusinessUseCaseClassification): string {
  return JSON.stringify(bc);
}

function buildVariantSignature(
  analysis: Omit<
    GroupAnalysis,
    | 'mainSignature'
    | 'variantSignature'
    | 'title'
    | 'example'
    | 'rows'
    | 'uniqueId'
    | 'safeType'
    | 'voucherType'
  >,
): string {
  const variant = {
    exactLineCount: analysis.variantDetails.exactLineCount,
    accountTypeComposition: analysis.variantDetails.accountTypeComposition,
    offsetAccountTypes: analysis.variantDetails.offsetAccountTypes,
    ledgerMainAccounts: analysis.variantDetails.ledgerMainAccounts,
    notesReceivableMainAccounts:
      analysis.variantDetails.notesReceivableMainAccounts,
    currencies: analysis.variantDetails.currencies,
    settlementLines: analysis.variantDetails.settlementLines,
    settlementPattern: analysis.classification.settlementPattern,
    isBalancedInSource: analysis.variantDetails.isBalancedInSource,
    customerCountBucket:
      analysis.variantDetails.customerLines > 1 ? 'MULTI' : 'ONE_OR_ZERO',
    invoiceCountBucket:
      analysis.classification.invoicePattern === 'NO_INVOICE'
        ? 'NO_INVOICE'
        : analysis.classification.invoicePattern === 'SINGLE_INVOICE'
          ? 'ONE_INVOICE'
          : 'MULTI_INVOICE',
  };

  return JSON.stringify(variant);
}

function analyzeGroup(
  uniqueId: number,
  group: CashEntryRawDataModel[],
  utilsService: EntryProcessorUtilsService,
): GroupAnalysis {
  const rows = group.map((line) => classifyRow(line, utilsService));
  const classified = classifyGroup(rows);
  const mainSignature = buildMainUseCaseSignature(
    classified.businessClassification,
  );
  const variantSignature = buildVariantSignature(classified);

  return {
    uniqueId,
    safeType: rows[0]?.safeType || '',
    voucherType: rows[0]?.voucherType || '',
    rows,
    example: buildExample(uniqueId, rows),
    title: buildTitle(classified.businessClassification),
    mainSignature,
    variantSignature,
    ...classified,
  };
}

function hasForbiddenMainSignatureContent(mainSignature: string): boolean {
  if (
    /"uniqueId"|"lineNumber"|"invoice"|"paymentReference"/i.test(mainSignature)
  ) {
    return true;
  }
  if (/\b\d{5,}\b/.test(mainSignature)) {
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const inputArg = getArgValue('--input') || DEFAULT_INPUT;
  const outputArg = getArgValue('--output') || DEFAULT_OUTPUT;

  const inputPath = resolve(process.cwd(), inputArg);
  const outputPath = resolve(process.cwd(), outputArg);

  const excelService = new ExcelService(new ExcelJsAdapter());
  const utilsService = new EntryProcessorUtilsService();
  const buffer = await fs.readFile(inputPath);
  const allRows =
    await excelService.excelToJson<Record<string, unknown>>(buffer);

  const cashInRows = allRows.filter(
    (row) => normalizeText(row.SafeTransaction).toLowerCase() === 'in',
  );

  const excludedSafeTypeSet = new Set<string>();
  for (const row of cashInRows) {
    const safeType = normalizeText(row.SafeType);
    if (safeType && !INCLUDED_SAFE_TYPES.has(safeType)) {
      excludedSafeTypeSet.add(safeType);
    }
  }

  const includedRows = cashInRows.filter((row) =>
    INCLUDED_SAFE_TYPES.has(normalizeText(row.SafeType)),
  );
  const rawLines = includedRows.map(
    (row) => new CashEntryRawDataModel(row as any, 'Freight'),
  );
  const sortedLines = [...rawLines].sort(
    (a, b) => Number(a.LINENUMBER) - Number(b.LINENUMBER),
  );

  const uniqueIdMap = new Map<number, CashEntryRawDataModel[]>();
  for (const line of sortedLines) {
    if (!line.UniqueId) continue;
    if (!uniqueIdMap.has(line.UniqueId)) uniqueIdMap.set(line.UniqueId, []);
    uniqueIdMap.get(line.UniqueId)!.push(line);
  }

  const countsBySafeType: Record<string, number> = {};
  const countsByVoucherType: Record<string, number> = {};
  const countsByLineCountBucket: Record<string, number> = {};
  const countsByBusinessOffsetMultiplicity: Record<string, number> = {};
  const countsByBusinessOffsetCategory: Record<string, number> = {};
  const countsByBusinessCurrencyPattern: Record<string, number> = {};

  const mainUseCaseMap = new Map<
    string,
    {
      useCase: MainUseCase;
      variantsBySignature: Map<string, Variant>;
      sortMeta: {
        safeType: string;
        voucherType: string;
        offsetCategoryPattern: string;
        riskScore: number;
      };
    }
  >();

  let useCaseCounter = 1;
  let totalVariants = 0;

  for (const [uniqueId, group] of uniqueIdMap.entries()) {
    const analysis = analyzeGroup(uniqueId, group, utilsService);
    addCount(countsBySafeType, analysis.safeType);
    addCount(countsByVoucherType, analysis.voucherType);
    addCount(countsByLineCountBucket, analysis.classification.lineCountBucket);

    let mainUseCaseEntry = mainUseCaseMap.get(analysis.mainSignature);
    if (!mainUseCaseEntry) {
      const useCaseId = `CASH_IN_UC_${String(useCaseCounter).padStart(3, '0')}`;
      useCaseCounter++;

      const bc = analysis.businessClassification;
      addCount(
        countsByBusinessOffsetMultiplicity,
        bc.offsetMultiplicityPattern,
      );
      addCount(countsByBusinessOffsetCategory, bc.offsetCategoryPattern);
      addCount(countsByBusinessCurrencyPattern, bc.currencyPattern);

      const useCase: MainUseCase = {
        useCaseId,
        title: analysis.title,
        mainSignature: analysis.mainSignature,
        frequency: 0,
        variantCount: 0,
        exampleUniqueIds: [],
        businessClassification: bc,
        classification: analysis.classification,
        riskFlags: analysis.riskFlags,
        variants: [],
        currentProcessorBehavior: analysis.currentProcessorBehavior,
        businessReview: {
          accountingDecision: '',
          requiredDfoAccount: '',
          requiredDfoOffset: '',
          creditAmountRule: '',
          currencyExchangeRule: '',
          settlementFxHandling: '',
          markedInvoiceRule: '',
          notes: '',
          approvedBy: '',
          approvedDate: '',
        },
      };

      mainUseCaseEntry = {
        useCase,
        variantsBySignature: new Map<string, Variant>(),
        sortMeta: {
          safeType: analysis.safeType,
          voucherType: analysis.voucherType,
          offsetCategoryPattern: bc.offsetCategoryPattern,
          riskScore: Object.values(analysis.riskFlags).filter(Boolean).length,
        },
      };
      mainUseCaseMap.set(analysis.mainSignature, mainUseCaseEntry);
    }

    mainUseCaseEntry.useCase.frequency += 1;
    if (mainUseCaseEntry.useCase.exampleUniqueIds.length < 3) {
      mainUseCaseEntry.useCase.exampleUniqueIds.push(uniqueId);
    }

    let variant = mainUseCaseEntry.variantsBySignature.get(
      analysis.variantSignature,
    );
    if (!variant) {
      const variantId = `${mainUseCaseEntry.useCase.useCaseId}_V${String(
        mainUseCaseEntry.variantsBySignature.size + 1,
      ).padStart(2, '0')}`;
      variant = {
        variantId,
        variantSignature: analysis.variantSignature,
        frequency: 0,
        exampleUniqueIds: [],
        details: analysis.variantDetails,
        examples: [],
      };
      mainUseCaseEntry.variantsBySignature.set(
        analysis.variantSignature,
        variant,
      );
      mainUseCaseEntry.useCase.variants.push(variant);
      mainUseCaseEntry.useCase.variantCount += 1;
      totalVariants += 1;
    }

    variant.frequency += 1;
    if (variant.exampleUniqueIds.length < 3) {
      variant.exampleUniqueIds.push(uniqueId);
    }
    if (variant.examples.length < 3) {
      variant.examples.push(analysis.example);
    }
  }

  const mainUseCasesWithMeta = [...mainUseCaseMap.values()];
  mainUseCasesWithMeta.sort((a, b) => {
    const safeTypeCmp = a.sortMeta.safeType.localeCompare(b.sortMeta.safeType);
    if (safeTypeCmp !== 0) return safeTypeCmp;

    const voucherCmp = a.sortMeta.voucherType.localeCompare(
      b.sortMeta.voucherType,
    );
    if (voucherCmp !== 0) return voucherCmp;

    const categoryCmp = a.sortMeta.offsetCategoryPattern.localeCompare(
      b.sortMeta.offsetCategoryPattern,
    );
    if (categoryCmp !== 0) return categoryCmp;

    const riskCmp = a.sortMeta.riskScore - b.sortMeta.riskScore;
    if (riskCmp !== 0) return riskCmp;

    return b.useCase.frequency - a.useCase.frequency;
  });

  const mainUseCases = mainUseCasesWithMeta.map((entry) => {
    entry.useCase.variants.sort((a, b) => b.frequency - a.frequency);
    return entry.useCase;
  });

  const countsByRiskFlag: Record<RiskFlagKey, number> = {
    hasSettlementLines: 0,
    hasMixedCurrencies: 0,
    hasMultipleCustomers: 0,
    hasMultipleInvoices: 0,
    hasLedgerOffset: 0,
    hasNotesReceivable: 0,
    cartesianProductRiskInCurrentProcessor: 0,
  };
  for (const useCase of mainUseCases) {
    for (const [flag, value] of Object.entries(useCase.riskFlags)) {
      if (flag in countsByRiskFlag && value) {
        addCount(countsByRiskFlag, flag);
      }
    }
  }

  const report = {
    summary: {
      sourceFile: inputArg,
      generatedAt: new Date().toISOString(),
      totalRows: allRows.length,
      totalCashInRows: cashInRows.length,
      totalUniqueIds: uniqueIdMap.size,
      totalMainUseCases: mainUseCases.length,
      totalVariants,
      includedSafeTypes: [...INCLUDED_SAFE_TYPES],
      excludedSafeTypes: [...excludedSafeTypeSet].sort(),
      countsBySafeType,
      countsByVoucherType,
      countsByLineCountBucket,
      countsByBusinessOffsetMultiplicity,
      countsByBusinessOffsetCategory,
      countsByBusinessCurrencyPattern,
      countsByRiskFlag,
    },
    mainUseCases,
  };

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  const mainUseCasesWithSettlement = mainUseCases.filter(
    (useCase) => useCase.riskFlags.hasSettlementLines,
  ).length;
  const mainUseCasesWithMixedCurrencies = mainUseCases.filter(
    (useCase) => useCase.riskFlags.hasMixedCurrencies,
  ).length;
  const mainUseCasesWithCartesianRisk = mainUseCases.filter(
    (useCase) => useCase.riskFlags.cartesianProductRiskInCurrentProcessor,
  ).length;

  const mainUseCasesWithMultiOffset = mainUseCases.filter(
    (uc) =>
      uc.businessClassification.offsetMultiplicityPattern === 'MULTI_OFFSET',
  ).length;

  console.info(`cash-in rows:                  ${cashInRows.length}`);
  console.info(`unique ids:                    ${uniqueIdMap.size}`);
  console.info(`main use cases:                ${mainUseCases.length}`);
  console.info(`variants:                      ${totalVariants}`);
  console.info(`  with settlement:             ${mainUseCasesWithSettlement}`);
  console.info(
    `  with mixed currencies:       ${mainUseCasesWithMixedCurrencies}`,
  );
  console.info(`  with multi offset:           ${mainUseCasesWithMultiOffset}`);
  console.info(
    `  with cartesian risk:         ${mainUseCasesWithCartesianRisk}`,
  );

  const hasBadMainSignature = mainUseCases.some((useCase) =>
    hasForbiddenMainSignatureContent(useCase.mainSignature),
  );
  console.info(`main signature quality check passed: ${!hasBadMainSignature}`);

  const settlementExamplesPresent = mainUseCases.some((useCase) =>
    useCase.variants.some((variant) =>
      variant.examples.some((example) =>
        example.sourceRows.some((row) => row.isSettlementLine),
      ),
    ),
  );
  console.info(
    `settlement lines preserved in examples: ${settlementExamplesPresent}`,
  );

  const includedSafeTypesCheck =
    mainUseCases.some(
      (uc) => uc.businessClassification.safeType === 'Customer Collection',
    ) &&
    mainUseCases.some(
      (uc) => uc.businessClassification.safeType === 'DownPayment',
    );
  console.info(`included safe types check passed: ${includedSafeTypesCheck}`);

  if (mainUseCases.length > 80) {
    console.info(
      'main use cases exceed 80; top 20 main signatures follow for fragmentation review:',
    );
    for (const useCase of [...mainUseCases]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20)) {
      console.info(`${useCase.frequency}x ${useCase.mainSignature}`);
    }
    console.info(
      'Fragmentation likely comes from: offsetCategoryPattern, currencyPattern, settlementPattern, amountBehaviorPattern, or sourceBalancePattern.',
    );
  }

  console.info(`written: ${outputArg}`);
}

main().catch((error) => {
  console.error('Failed to analyze Cash-In use cases.');
  console.error(error);
  process.exitCode = 1;
});
