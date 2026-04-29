import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';

type RiskFlagKey =
  | 'hasSettlementLines'
  | 'hasMixedCurrencies'
  | 'hasMultipleVendors'
  | 'hasMultipleInvoices'
  | 'hasLedgerOffset'
  | 'hasRoutedLines'
  | 'cartesianProductRiskInCurrentProcessor';

type MappingBucket =
  | 'CASH_OUT_MAPPING'
  | 'ROUTED_CUSTODY_SETTLEMENT'
  | 'ROUTED_VENDOR_PAYMENT'
  | 'ROUTED_CUSTODY_ISSUE';

type RoutedBucketKey = 'custodySettlement' | 'vendorPayment' | 'custodyIssue';

type BusinessUseCaseClassification = {
  safeTransaction: 'Out';
  safeType: string;
  voucherType: string;
  mappingBucket: MappingBucket;
  accountSidePattern: string;
  offsetMultiplicityPattern: string;
  offsetCategoryPattern: string;
  currencyPattern: string;
  settlementPattern: string;
  sourceBalancePattern: string;
  amountBehaviorPattern: string;
};

type DetailedClassification = {
  lineCountBucket: string;
  accountTypeCompositionBucket: string;
  invoicePattern: string;
  currentProcessorBehaviorPattern: string;
};

type ClassifiedRow = {
  lineNumber: number;
  safeTransaction: 'Out';
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
  isVendorLine: boolean;
  isOffsetLine: boolean;
  isCustomerLine: boolean;
  isLedgerLine: boolean;
  isSettlementLine: boolean;
  settlementMainAccount?: '421103';
  isNotesReceivableLine: boolean;
  isRoutedLine: boolean;
  routedBucket: RoutedBucketKey | null;
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

type GroupAnalysis = {
  uniqueId: number;
  safeType: string;
  voucherType: string;
  lineCount: number;
  rows: ClassifiedRow[];
  example: Example;
  businessClassification: BusinessUseCaseClassification;
  detailedClassification: DetailedClassification;
  mainSignature: string;
  variantSignature: string;
  title: string;
  riskFlags: {
    hasMoreThanTwoLines: boolean;
    hasSettlementLines: boolean;
    hasMixedCurrencies: boolean;
    hasMultipleVendors: boolean;
    hasMultipleInvoices: boolean;
    hasLedgerOffset: boolean;
    hasRoutedLines: boolean;
    cartesianProductRiskInCurrentProcessor: boolean;
  };
  variantDetails: {
    exactLineCount: number;
    accountTypeComposition: Record<string, number>;
    vendorLines: number;
    offsetLines: number;
    ledgerLines: number;
    settlementLines: number;
    offsetAccountTypes: string[];
    ledgerMainAccounts: string[];
    currencies: string[];
    isBalancedInSource: boolean;
  };
  currentProcessorBehavior: {
    accountLineSelector: string;
    offsetLineSelector: string;
    caseUsed: string;
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
  detailedClassification: DetailedClassification;
  riskFlags: GroupAnalysis['riskFlags'];
  variants: Variant[];
  currentProcessorBehavior: GroupAnalysis['currentProcessorBehavior'];
  businessReview: {
    accountingDecision: string;
    requiredDfoAccount: string;
    requiredDfoOffset: string;
    debitAmountRule: string;
    currencyExchangeRule: string;
    settlementFxHandling: string;
    invoiceRule: string;
    notes: string;
    approvedBy: string;
    approvedDate: string;
  };
};

const NOTES_RECEIVABLE_MAIN_ACCOUNTS = new Set([
  '122201',
  '122202',
  '122203',
  '122204',
  '123510',
]);
const SETTLEMENT_MAIN_ACCOUNT = '421103';
const DEFAULT_INPUT = 'src/excel-sources/Cash/Safe Out_01_26_Freight.xlsx';
const DEFAULT_OUTPUT = 'src/analysis/cash-out-use-cases.json';
const ACCOUNT_TYPE_ORDER = ['Vend', 'Bank', 'Petty cash', 'Ledger', 'Cust'];

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
    return normalizeText((v as Record<string, unknown>).result);
  }
  return '';
}

function normalizeCurrency(v: unknown): string {
  return normalizeText(v).toUpperCase();
}

function normalizeAccountType(v: unknown): string {
  const value = normalizeText(v);
  const lower = value.toLowerCase();
  if (lower === 'vend') return 'Vend';
  if (lower === 'cust') return 'Cust';
  if (lower === 'ledger') return 'Ledger';
  if (lower === 'bank') return 'Bank';
  if (lower === 'petty cash') return 'Petty cash';
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

function detectRoutedBucket(line: CashEntryRawDataModel): RoutedBucketKey | null {
  if (line.IsCustodySettlement) return 'custodySettlement';
  if (line.IsVendorPayment) return 'vendorPayment';
  if (line.IsCustodyIssue) return 'custodyIssue';
  return null;
}

function classifyRow(
  line: CashEntryRawDataModel,
  utilsService: EntryProcessorUtilsService,
): ClassifiedRow {
  const accountType = normalizeAccountType(line.ACCOUNTTYPE);
  const mainAccount = parseMainAccount(utilsService, line.ACCOUNTDISPLAYVALUE);
  const isVendorLine = accountType === 'Vend';
  const isCustomerLine = accountType === 'Cust';
  const isLedgerLine = accountType === 'Ledger';
  const isSettlementLine =
    isLedgerLine && mainAccount === SETTLEMENT_MAIN_ACCOUNT;
  const isNotesReceivableLine =
    isLedgerLine && NOTES_RECEIVABLE_MAIN_ACCOUNTS.has(mainAccount);
  const routedBucket = detectRoutedBucket(line);

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
    safeTransaction: 'Out',
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
    isVendorLine,
    isOffsetLine: !isVendorLine,
    isCustomerLine,
    isLedgerLine,
    isSettlementLine,
    ...(isSettlementLine ? { settlementMainAccount: '421103' as const } : {}),
    isNotesReceivableLine,
    isRoutedLine: routedBucket !== null,
    routedBucket,
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
    fmt(bc.mappingBucket),
    fmt(bc.offsetCategoryPattern),
    fmt(bc.offsetMultiplicityPattern),
    fmt(bc.currencyPattern),
  ].join(' / ');
}

function buildBusinessUseCaseClassification(derived: {
  safeType: string;
  voucherType: string;
  mappingBucket: MappingBucket;
  accountSidePattern: string;
  offsetMultiplicityPattern: string;
  offsetCategoryPattern: string;
  currencyPattern: string;
  settlementPattern: string;
  sourceBalancePattern: string;
  amountBehaviorPattern: string;
}): BusinessUseCaseClassification {
  return {
    safeTransaction: 'Out',
    safeType: derived.safeType,
    voucherType: derived.voucherType,
    mappingBucket: derived.mappingBucket,
    accountSidePattern: derived.accountSidePattern,
    offsetMultiplicityPattern: derived.offsetMultiplicityPattern,
    offsetCategoryPattern: derived.offsetCategoryPattern,
    currencyPattern: derived.currencyPattern,
    settlementPattern: derived.settlementPattern,
    sourceBalancePattern: derived.sourceBalancePattern,
    amountBehaviorPattern: derived.amountBehaviorPattern,
  };
}

function classifyGroup(rows: ClassifiedRow[]): Omit<
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
    Vend: 0,
    Bank: 0,
    'Petty cash': 0,
    Ledger: 0,
    Cust: 0,
  };
  const currencies = uniqueSorted(rows.map((row) => row.currencyCode));
  const invoices = uniqueSorted(rows.map((row) => row.invoice).filter(Boolean));

  let vendorLines = 0;
  let offsetLines = 0;
  let ledgerLines = 0;
  let settlementLines = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let vendorDebit = 0;
  let vendorCredit = 0;
  let offsetDebit = 0;
  let offsetCredit = 0;

  for (const row of rows) {
    composition[row.accountType] = (composition[row.accountType] || 0) + 1;
    totalDebit += row.debitAmount;
    totalCredit += row.creditAmount;

    if (row.isVendorLine) {
      vendorLines++;
      vendorDebit += row.debitAmount;
      vendorCredit += row.creditAmount;
    } else {
      offsetLines++;
      offsetDebit += row.debitAmount;
      offsetCredit += row.creditAmount;
    }

    if (row.isLedgerLine) ledgerLines++;
    if (row.isSettlementLine) settlementLines++;
  }

  const hasMixedCurrencies = currencies.length > 1;
  const isBalancedInSource = Math.abs(totalDebit - totalCredit) <= 0.01;
  const hasZeroOrEmptyAmount = rows.every(
    (row) => row.debitAmount === 0 && row.creditAmount === 0,
  );

  const accountSidePattern =
    vendorLines === 0
      ? rows.some((r) => r.isCustomerLine)
        ? 'CUSTOMER_ACCOUNT_SIDE'
        : rows.some((r) => r.isLedgerLine)
          ? 'LEDGER_ACCOUNT_SIDE'
          : 'NO_VENDOR'
      : vendorLines === 1
        ? 'ONE_VENDOR'
        : 'MULTI_VENDOR';

  const offsetMultiplicityPattern =
    offsetLines === 0 ? 'NO_OFFSET' : offsetLines === 1 ? 'SINGLE_OFFSET' : 'MULTI_OFFSET';

  const offsetCategoryCandidates = uniqueSorted(
    rows
      .filter((row) => row.isOffsetLine)
      .map((row) => {
        if (row.accountType === 'Bank') return 'BANK';
        if (row.accountType === 'Petty cash') return 'PETTY_CASH';
        if (row.accountType === 'Cust') return 'CUST';
        if (row.accountType === 'Vend') return 'VEND';
        if (row.isLedgerLine) return row.ledgerCategory;
        return 'OTHER';
      }),
  );

  const offsetCategoryPattern =
    offsetCategoryCandidates.length === 0
      ? 'NO_OFFSET'
      : offsetCategoryCandidates.length === 1
        ? offsetCategoryCandidates[0]
        : 'MIXED_OFFSET_CATEGORIES';

  const currencyPattern = hasMixedCurrencies ? 'MIXED_CURRENCY' : 'SINGLE_CURRENCY';
  const settlementPattern =
    settlementLines > 0 ? 'HAS_SETTLEMENT_421103' : 'NO_SETTLEMENT';
  const sourceBalancePattern = isBalancedInSource
    ? 'BALANCED_SOURCE'
    : 'UNBALANCED_SOURCE';

  let amountBehaviorPattern = 'REVERSED_OR_UNUSUAL_AMOUNT_BEHAVIOR';
  if (!isBalancedInSource) {
    amountBehaviorPattern = 'UNBALANCED_SOURCE';
  } else if (hasZeroOrEmptyAmount) {
    amountBehaviorPattern = 'ZERO_OR_EMPTY_AMOUNT';
  } else if (
    vendorDebit > 0 &&
    vendorCredit === 0 &&
    offsetCredit > 0 &&
    offsetDebit === 0
  ) {
    amountBehaviorPattern =
      settlementLines > 0
        ? 'NORMAL_CASH_OUT_WITH_SETTLEMENT'
        : 'NORMAL_CASH_OUT';
  }

  const mappingBucket: MappingBucket =
    rows.every((r) => r.routedBucket === 'custodySettlement')
      ? 'ROUTED_CUSTODY_SETTLEMENT'
      : rows.every((r) => r.routedBucket === 'vendorPayment')
        ? 'ROUTED_VENDOR_PAYMENT'
        : rows.every((r) => r.routedBucket === 'custodyIssue')
          ? 'ROUTED_CUSTODY_ISSUE'
          : 'CASH_OUT_MAPPING';

  const withoutSettlement = rows.filter((row) => !row.isSettlementLine);
  const vendorLinesAfterSettlement = withoutSettlement.filter(
    (row) => row.isVendorLine,
  ).length;
  const offsetLinesAfterSettlement = withoutSettlement.filter(
    (row) => row.isOffsetLine,
  ).length;
  const cartesianRisk =
    vendorLinesAfterSettlement > 1 && offsetLinesAfterSettlement > 1;

  const detailedClassification: DetailedClassification = {
    lineCountBucket: buildLineCountBucket(lineCount),
    accountTypeCompositionBucket: buildAccountTypeCompositionBucket(composition),
    invoicePattern:
      invoices.length === 0
        ? 'NO_INVOICE'
        : invoices.length === 1
          ? 'SINGLE_INVOICE'
          : 'MULTI_INVOICE',
    currentProcessorBehaviorPattern:
      lineCount === 2
        ? 'CASE_TWO_LINES'
        : cartesianRisk
          ? 'CASE_MORE_THAN_TWO_LINES_CARTESIAN_RISK'
          : 'CASE_MORE_THAN_TWO_LINES_NON_CARTESIAN',
  };

  const riskFlags = {
    hasMoreThanTwoLines: lineCount > 2,
    hasSettlementLines: settlementLines > 0,
    hasMixedCurrencies: hasMixedCurrencies,
    hasMultipleVendors: vendorLines > 1,
    hasMultipleInvoices: invoices.length > 1,
    hasLedgerOffset: rows.some((row) => row.isOffsetLine && row.isLedgerLine),
    hasRoutedLines: rows.some((row) => row.isRoutedLine),
    cartesianProductRiskInCurrentProcessor: cartesianRisk,
  };

  return {
    lineCount,
    businessClassification: buildBusinessUseCaseClassification({
      safeType: rows[0]?.safeType || '',
      voucherType: rows[0]?.voucherType || '',
      mappingBucket,
      accountSidePattern,
      offsetMultiplicityPattern,
      offsetCategoryPattern,
      currencyPattern,
      settlementPattern,
      sourceBalancePattern,
      amountBehaviorPattern,
    }),
    detailedClassification,
    riskFlags,
    variantDetails: {
      exactLineCount: lineCount,
      accountTypeComposition: composition,
      vendorLines,
      offsetLines,
      ledgerLines,
      settlementLines,
      offsetAccountTypes: uniqueSorted(
        rows.filter((row) => row.isOffsetLine).map((row) => row.accountType),
      ),
      ledgerMainAccounts: uniqueSorted(
        rows
          .filter((row) => row.isLedgerLine)
          .map((row) => row.mainAccount)
          .filter(Boolean),
      ),
      currencies,
      isBalancedInSource,
    },
    currentProcessorBehavior: {
      accountLineSelector: 'Vendor for outbound',
      offsetLineSelector: 'non-Vendor for outbound',
      caseUsed: lineCount === 2 ? 'caseTwoLines' : 'caseMoreThanTwoLines',
      expectedGeneratedLineCountFormula:
        lineCount === 2 ? '1 line' : 'vendorLines * offsetLines',
      hasCartesianProductRisk: cartesianRisk,
      notes: [
        'Current outbound processor selects account line as Vendor and offset as non-Vendor.',
        'For more than two lines, current logic may produce vendorLines * offsetLines cartesian output.',
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
    currencies: analysis.variantDetails.currencies,
    settlementLines: analysis.variantDetails.settlementLines,
    isBalancedInSource: analysis.variantDetails.isBalancedInSource,
    vendorCountBucket:
      analysis.variantDetails.vendorLines > 1 ? 'MULTI' : 'ONE_OR_ZERO',
    invoiceCountBucket: analysis.detailedClassification.invoicePattern,
    currentProcessorBehaviorPattern:
      analysis.detailedClassification.currentProcessorBehaviorPattern,
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

  const cashOutRows = allRows.filter(
    (row) => normalizeText(row.SafeTransaction).toLowerCase() === 'out',
  );
  const rawLines = cashOutRows.map(
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
  const countsByMappingBucket: Record<string, number> = {};
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
        mappingBucket: string;
        offsetCategoryPattern: string;
        riskScore: number;
      };
    }
  >();

  let useCaseCounter = 1;
  let totalVariants = 0;
  let mappingRows = 0;

  const routedBuckets = {
    custodySettlement: {
      rows: 0,
      uniqueIds: new Set<number>(),
      examples: [] as Example[],
    },
    vendorPayment: {
      rows: 0,
      uniqueIds: new Set<number>(),
      examples: [] as Example[],
    },
    custodyIssue: {
      rows: 0,
      uniqueIds: new Set<number>(),
      examples: [] as Example[],
    },
  };

  for (const [uniqueId, group] of uniqueIdMap.entries()) {
    const analysis = analyzeGroup(uniqueId, group, utilsService);
    addCount(countsBySafeType, analysis.safeType || 'UNKNOWN');
    addCount(countsByVoucherType, analysis.voucherType || 'UNKNOWN');
    addCount(countsByMappingBucket, analysis.businessClassification.mappingBucket);
    addCount(
      countsByBusinessOffsetMultiplicity,
      analysis.businessClassification.offsetMultiplicityPattern,
    );
    addCount(
      countsByBusinessOffsetCategory,
      analysis.businessClassification.offsetCategoryPattern,
    );
    addCount(
      countsByBusinessCurrencyPattern,
      analysis.businessClassification.currencyPattern,
    );

    const groupedRows = analysis.rows.length;
    const routedKinds = new Set<RoutedBucketKey>(
      analysis.rows
        .map((row) => row.routedBucket)
        .filter((x): x is RoutedBucketKey => x !== null),
    );
    if (analysis.businessClassification.mappingBucket === 'CASH_OUT_MAPPING') {
      mappingRows += groupedRows;
    }
    for (const bucket of routedKinds) {
      routedBuckets[bucket].rows += analysis.rows.filter(
        (r) => r.routedBucket === bucket,
      ).length;
      routedBuckets[bucket].uniqueIds.add(uniqueId);
      if (routedBuckets[bucket].examples.length < 3) {
        routedBuckets[bucket].examples.push(analysis.example);
      }
    }

    if (analysis.businessClassification.mappingBucket !== 'CASH_OUT_MAPPING') {
      continue;
    }

    let mainUseCaseEntry = mainUseCaseMap.get(analysis.mainSignature);
    if (!mainUseCaseEntry) {
      const useCaseId = `CASH_OUT_UC_${String(useCaseCounter).padStart(3, '0')}`;
      useCaseCounter++;

      const useCase: MainUseCase = {
        useCaseId,
        title: analysis.title,
        mainSignature: analysis.mainSignature,
        frequency: 0,
        variantCount: 0,
        exampleUniqueIds: [],
        businessClassification: analysis.businessClassification,
        detailedClassification: analysis.detailedClassification,
        riskFlags: analysis.riskFlags,
        variants: [],
        currentProcessorBehavior: analysis.currentProcessorBehavior,
        businessReview: {
          accountingDecision: '',
          requiredDfoAccount: '',
          requiredDfoOffset: '',
          debitAmountRule: '',
          currencyExchangeRule: '',
          settlementFxHandling: '',
          invoiceRule: '',
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
          mappingBucket: analysis.businessClassification.mappingBucket,
          offsetCategoryPattern:
            analysis.businessClassification.offsetCategoryPattern,
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
      mainUseCaseEntry.variantsBySignature.set(analysis.variantSignature, variant);
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

    const mappingCmp = a.sortMeta.mappingBucket.localeCompare(
      b.sortMeta.mappingBucket,
    );
    if (mappingCmp !== 0) return mappingCmp;

    const offsetCmp = a.sortMeta.offsetCategoryPattern.localeCompare(
      b.sortMeta.offsetCategoryPattern,
    );
    if (offsetCmp !== 0) return offsetCmp;

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
    hasMultipleVendors: 0,
    hasMultipleInvoices: 0,
    hasLedgerOffset: 0,
    hasRoutedLines: 0,
    cartesianProductRiskInCurrentProcessor: 0,
  };
  for (const useCase of mainUseCases) {
    for (const [flag, value] of Object.entries(useCase.riskFlags)) {
      if (flag in countsByRiskFlag && value) {
        addCount(countsByRiskFlag, flag);
      }
    }
  }

  const mappingUniqueIds = mainUseCases.reduce(
    (sum, uc) => sum + uc.frequency,
    0,
  );

  const report = {
    summary: {
      sourceFile: inputArg,
      generatedAt: new Date().toISOString(),
      totalRows: allRows.length,
      totalCashOutRows: cashOutRows.length,
      totalUniqueIds: uniqueIdMap.size,
      totalMainUseCases: mainUseCases.length,
      totalVariants,
      countsBySafeType,
      countsByVoucherType,
      countsByMappingBucket,
      countsByBusinessOffsetMultiplicity,
      countsByBusinessOffsetCategory,
      countsByBusinessCurrencyPattern,
      countsByRiskFlag,
    },
    routedBuckets: {
      custodySettlement: {
        rows: routedBuckets.custodySettlement.rows,
        uniqueIds: routedBuckets.custodySettlement.uniqueIds.size,
        examples: routedBuckets.custodySettlement.examples,
      },
      vendorPayment: {
        rows: routedBuckets.vendorPayment.rows,
        uniqueIds: routedBuckets.vendorPayment.uniqueIds.size,
        examples: routedBuckets.vendorPayment.examples,
      },
      custodyIssue: {
        rows: routedBuckets.custodyIssue.rows,
        uniqueIds: routedBuckets.custodyIssue.uniqueIds.size,
        examples: routedBuckets.custodyIssue.examples,
      },
    },
    mainUseCases,
  };

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  const ucWithMixedCurrencies = mainUseCases.filter(
    (uc) => uc.riskFlags.hasMixedCurrencies,
  ).length;
  const ucWithMultiOffset = mainUseCases.filter(
    (uc) =>
      uc.businessClassification.offsetMultiplicityPattern === 'MULTI_OFFSET',
  ).length;
  const ucWithCartesianRisk = mainUseCases.filter(
    (uc) => uc.riskFlags.cartesianProductRiskInCurrentProcessor,
  ).length;

  console.info(`cash-out rows:                            ${cashOutRows.length}`);
  console.info(`unique ids:                              ${uniqueIdMap.size}`);
  console.info(
    `routed custody settlement rows/groups:   ${routedBuckets.custodySettlement.rows}/${routedBuckets.custodySettlement.uniqueIds.size}`,
  );
  console.info(
    `routed vendor payment rows/groups:       ${routedBuckets.vendorPayment.rows}/${routedBuckets.vendorPayment.uniqueIds.size}`,
  );
  console.info(
    `routed custody issue rows/groups:        ${routedBuckets.custodyIssue.rows}/${routedBuckets.custodyIssue.uniqueIds.size}`,
  );
  console.info(`mapping rows/groups:                     ${mappingRows}/${mappingUniqueIds}`);
  console.info(`main use cases:                          ${mainUseCases.length}`);
  console.info(`variants:                                ${totalVariants}`);
  console.info(`main use cases with mixed currencies:    ${ucWithMixedCurrencies}`);
  console.info(`main use cases with multi offset:        ${ucWithMultiOffset}`);
  console.info(`main use cases with cartesian risk:      ${ucWithCartesianRisk}`);

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
      'Reduce fragmentation by simplifying mappingBucket/accountSidePattern/offsetCategoryPattern/amountBehaviorPattern splits.',
    );
  }

  console.info(`written output path:                     ${outputArg}`);
}

main().catch((error) => {
  console.error('Failed to analyze Cash-Out use cases.');
  console.error(error);
  process.exitCode = 1;
});

