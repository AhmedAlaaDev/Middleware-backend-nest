export interface ReconciliationOptions {
  toleranceDays: number;
  amountTolerance: number;
  confidenceThreshold: number;
  audit: boolean;
  allowManyToOne: boolean;
  forceAll: boolean;
}

export type TransactionDirection = 'deposit' | 'withdraw' | null;

export interface BankTransaction {
  index: number;
  excelRowNumber: number;
  bankRef: string;
  normalizedRef: string;
  compactRef: string;
  description: string;
  clientName: string;
  supplierBeneficiary: string;
  cashFlow: string;
  customerReference: string;
  dynamicsEntry: string;
  transactionDate: Date | null;
  valueDate: Date | null;
  epochDay: number | null;
  valueEpochDay: number | null;
  amount: number | null;
  direction: TransactionDirection;
  dynCode: string;
  normalizedDynCode: string;
  currency: string;
  searchText: string;
  partyText: string;
}

export interface IstTransaction {
  excelRowNumber: number;
  description: string;
  mainAccount: string;
  voucher: string;
  uniqueId: string;
  journalName: string;
  clientName: string;
  customer: string;
  operationNo: string;
  document: string;
  invoice: string;
  paymentReference: string;
  quotationNo: string;
  mbl: string;
  containerNo: string;
  hbl: string;
  voyageNo: string;
  vesselName: string;
  locations: string;
  safeType: string;
  transactionDate: Date | null;
  epochDay: number | null;
  amount: number | null;
  direction: TransactionDirection;
  accountCode: string;
  currency: string;
  hasValidPaymentReference: boolean;
  directSearchTexts: string[];
  searchText: string;
  partyText: string;
  hintText: string;
  referenceTokens: string[];
}

export type MatchStatus = 'Matched' | 'Needs Review' | 'Unmatched';
export type MatchCase =
  | 'Existing Reference Preserved'
  | 'Direct Reference Match'
  | 'Account + Date + Amount Match'
  | 'Grouped Settlement Match'
  | 'Cash Journal Amount + Date Match'
  | 'Forced Best Bank Match'
  | 'Amount + Description Fallback Match'
  | 'Near Amount + Client Match'
  | 'Date + Amount + Terms Match'
  | 'Fuzzy Probable Match'
  | 'Incorrect or Ambiguous Link'
  | 'No Candidate';

export interface MatchResult {
  status: MatchStatus;
  matchCase: MatchCase;
  confidence: number;
  reason: string;
  bank?: BankTransaction;
}

export interface ScoredCandidate {
  bank: BankTransaction;
  score: number;
  amountScore: number;
  dateScore: number;
  accountScore: number;
  directionScore: number;
  referenceScore: number;
  descriptionScore: number;
  partyScore: number;
  hintBonus: number;
  sharedTerms: string[];
}

export interface ReviewRecord {
  istRowNumber: number;
  status: MatchStatus;
  matchCase: MatchCase;
  confidence: number;
  reason: string;
  description: string;
  transactionDate: string;
  amount: number | null;
  direction: TransactionDirection;
  accountCode: string;
  clientName: string;
  operationNo: string;
  document: string;
  existingPaymentReference: string;
  suggestedBankRef: string;
  suggestedBankRowNumber: number | null;
  finalPaymentReference: string;
}

export interface ReconciliationSummary {
  totalRows: number;
  matched: number;
  preserved: number;
  needsReview: number;
  unmatched: number;
  paymentReferencesFilled: number;
  forcedBankMatches: number;
  remainingBlankPaymentReferences: number;
  reviewRecordsReturned: number;
  reviewRecordsTruncated: boolean;
}

export interface ReconciliationReport {
  summary: ReconciliationSummary;
  reviewRecords: ReviewRecord[];
  unmatchedBankRecords?: BankTransaction[];
}

export interface ReconciliationOutput {
  workbook: Buffer;
  report: ReconciliationReport;
}

export const IST_REQUIRED_COLUMNS = [
  'DESCRIPTION',
  'TRANSDATE',
  'DEBIT',
  'CREDIT',
  'Client Name',
  'Operation No',
  'DOCUMENT',
  'INVOICE',
  'PAYMENTREFERENCE',
] as const;

export const BANK_REQUIRED_COLUMNS = [
  'Transaction date',
  'bank Ref',
  'Description',
  'Deposit',
  'Withdraw',
  'Client Name',
  'Supplier Beneficiary',
  'cash flow',
  'Dyn_Map.Dyn code',
] as const;

export const AUDIT_COLUMNS = [
  'MATCH_STATUS',
  'MATCH_CASE',
  'MATCH_CONFIDENCE',
  'MATCH_REASON',
  'BANK_ROW_NUMBER',
  'BANK_REF',
  'BANK_DESCRIPTION',
  'BANK_DATE',
] as const;

export const MATCHING_RULES = [
  {
    priority: 1,
    name: 'Preserve valid existing reference',
    rule: 'Keep every non-placeholder PAYMENTREFERENCE already present in IST.',
    outputCase: 'Existing Reference Preserved',
  },
  {
    priority: 2,
    name: 'Direct reference and shipment token',
    rule: 'Find an exact bank reference, bank Dynamics entry, or IST token in the opposite file. IST tokens include operation number, voucher, unique id, customer, quotation, MBL, container, HBL, voyage, document, invoice, and payment reference.',
    outputCase: 'Direct Reference Match',
  },
  {
    priority: 3,
    name: 'Verified bank transaction',
    rule: 'Require currency and direction agreement, exact amount within tolerance, compatible bank account, and date/text/shipment-token evidence.',
    outputCase: 'Account + Date + Amount Match',
  },
  {
    priority: 4,
    name: 'Grouped settlement',
    rule: 'Match multiple IST rows sharing account, date, direction, and client when their total equals one bank transaction.',
    outputCase: 'Grouped Settlement Match',
  },
  {
    priority: 5,
    name: 'CashIn/CashOut amount and date',
    rule: 'For CashIn and CashOut journals, fill only one real unused bank reference when the debit/credit amount is exact, the bank direction is the same, the bank text is cash deposit or withdrawal, and the date is within tolerance.',
    outputCase: 'Cash Journal Amount + Date Match',
  },
  {
    priority: 6,
    name: 'Best real bank fallback',
    rule: 'For an IST row still unmatched, choose only a real unused bank reference using exact amount, direction, date, account, client, description, and shipment-token evidence.',
    outputCase: 'Forced Best Bank Match',
  },
  {
    priority: 7,
    name: 'Near amount with strong client evidence',
    rule: 'When the amount is close but not exact, fill only a real bank reference if account, currency, direction, and date align and client/reference evidence is strong enough to explain bank fees or net settlement.',
    outputCase: 'Near Amount + Client Match',
  },
  {
    priority: 8,
    name: 'Amount and description fallback',
    rule: 'If account mapping is missing, use exact amount plus date, direction, client, description, or shipment-token evidence to select a real bank reference; otherwise leave PAYMENTREFERENCE blank for review.',
    outputCase: 'Amount + Description Fallback Match',
  },
] as const;
