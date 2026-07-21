import levenshtein from 'fast-levenshtein';

import {
  BankTransaction,
  IstTransaction,
  MatchResult,
  ReconciliationOptions,
  ScoredCandidate,
} from '../types';

import {
  compactText,
  meaningfulTerms,
  normalizeAccountCode,
  normalizeReference,
  normalizeText,
} from './normalization';

interface TrieNode {
  next: Map<string, number>;
  fail: number;
  outputs: number[];
}

export class ReferenceMatcher {
  private readonly nodes: TrieNode[] = [
    { next: new Map(), fail: 0, outputs: [] },
  ];

  constructor(private readonly banks: BankTransaction[]) {
    banks.forEach((bank) => {
      if (bank.compactRef.length >= 4) this.add(bank.compactRef, bank.index);
    });
    this.buildFailureLinks();
  }

  find(texts: string[]): BankTransaction[] {
    const found = new Set<number>();
    for (const source of texts) {
      const text = compactText(source);
      let state = 0;
      for (const char of text) {
        while (state !== 0 && !this.nodes[state].next.has(char))
          state = this.nodes[state].fail;
        state = this.nodes[state].next.get(char) ?? 0;
        for (const bankIndex of this.nodes[state].outputs) found.add(bankIndex);
      }
    }
    return [...found].map((index) => this.banks[index]);
  }

  private add(pattern: string, bankIndex: number): void {
    let state = 0;
    for (const char of pattern) {
      let next = this.nodes[state].next.get(char);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes[state].next.set(char, next);
        this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
      }
      state = next;
    }
    this.nodes[state].outputs.push(bankIndex);
  }

  private buildFailureLinks(): void {
    const queue: number[] = [];
    for (const next of this.nodes[0].next.values()) queue.push(next);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const state = queue[cursor];
      for (const [char, next] of this.nodes[state].next) {
        queue.push(next);
        let failure = this.nodes[state].fail;
        while (failure !== 0 && !this.nodes[failure].next.has(char)) {
          failure = this.nodes[failure].fail;
        }
        this.nodes[next].fail = this.nodes[failure].next.get(char) ?? 0;
        this.nodes[next].outputs.push(
          ...this.nodes[this.nodes[next].fail].outputs,
        );
      }
    }
  }
}

class TrieOfIsts {
  private readonly nodes: TrieNode[] = [
    { next: new Map(), fail: 0, outputs: [] },
  ];

  constructor(patterns: { pattern: string; rowNumber: number }[]) {
    patterns.forEach(({ pattern, rowNumber }) => {
      this.add(pattern, rowNumber);
    });
    this.buildFailureLinks();
  }

  private add(pattern: string, rowNumber: number): void {
    let state = 0;
    for (const char of pattern) {
      let next = this.nodes[state].next.get(char);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes[state].next.set(char, next);
        this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
      }
      state = next;
    }
    this.nodes[state].outputs.push(rowNumber);
  }

  private buildFailureLinks(): void {
    const queue: number[] = [];
    for (const next of this.nodes[0].next.values()) queue.push(next);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const state = queue[cursor];
      for (const [char, next] of this.nodes[state].next) {
        queue.push(next);
        let failure = this.nodes[state].fail;
        while (failure !== 0 && !this.nodes[failure].next.has(char)) {
          failure = this.nodes[failure].fail;
        }
        this.nodes[next].fail = this.nodes[failure].next.get(char) ?? 0;
        this.nodes[next].outputs.push(
          ...this.nodes[this.nodes[next].fail].outputs,
        );
      }
    }
  }

  find(texts: string[]): number[] {
    const found = new Set<number>();
    for (const source of texts) {
      if (!source) continue;
      const text = compactText(source);
      let state = 0;
      for (const char of text) {
        while (state !== 0 && !this.nodes[state].next.has(char))
          state = this.nodes[state].fail;
        state = this.nodes[state].next.get(char) ?? 0;
        for (const rowNum of this.nodes[state].outputs) found.add(rowNum);
      }
    }
    return [...found];
  }
}

export class TwoWayReferenceMatcher {
  private readonly bankRefTrie: ReferenceMatcher;
  private readonly istToBankMatches = new Map<number, BankTransaction[]>();

  constructor(
    private readonly banks: BankTransaction[],
    ists: IstTransaction[],
  ) {
    this.bankRefTrie = new ReferenceMatcher(banks);

    // Build IST Reference Trie
    const istPatterns: { pattern: string; rowNumber: number }[] = [];
    ists.forEach((ist) => {
      ist.directSearchTexts.forEach((text) => {
        const compact = compactText(text);
        if (compact.length >= 4) {
          if (/^\d+$/.test(compact) && compact.length < 5) return;
          istPatterns.push({ pattern: compact, rowNumber: ist.excelRowNumber });
        }
      });
    });

    if (istPatterns.length > 0) {
      const istTrie = new TrieOfIsts(istPatterns);
      banks.forEach((bank) => {
        const searchTexts = [
          bank.compactRef,
          bank.description,
          bank.customerReference,
          bank.dynamicsEntry,
          bank.partyText,
          bank.supplierBeneficiary,
        ].filter(Boolean);
        const matchedRowNumbers = istTrie.find(searchTexts);
        matchedRowNumbers.forEach((rowNum) => {
          let list = this.istToBankMatches.get(rowNum);
          if (!list) {
            list = [];
            this.istToBankMatches.set(rowNum, list);
          }
          list.push(bank);
        });
      });
    }
  }

  find(texts: string[], istRowNumber: number): BankTransaction[] {
    const found = new Set<BankTransaction>();

    // 1. Direction A: bank reference is a substring of IST text
    const aMatches = this.bankRefTrie.find(texts);
    aMatches.forEach((bank) => found.add(bank));

    // 2. Direction B: IST reference is a substring of bank reference/description
    const bMatches = this.istToBankMatches.get(istRowNumber);
    if (bMatches) {
      bMatches.forEach((bank) => found.add(bank));
    }

    return [...found];
  }
}

export function textSimilarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const editScore = 1 - levenshtein.get(a, b) / Math.max(a.length, b.length);
  const aTerms = new Set(meaningfulTerms(a));
  const bTerms = new Set(meaningfulTerms(b));
  const intersection = [...aTerms].filter((term) => bTerms.has(term)).length;
  const union = new Set([...aTerms, ...bTerms]).size;
  const tokenScore = union ? intersection / union : 0;
  return clamp(Math.max(editScore, tokenScore * 0.7 + editScore * 0.3));
}

export function sharedMeaningfulTerms(left: string, right: string): string[] {
  const rightTerms = new Set(meaningfulTerms(right));
  return [
    ...new Set(meaningfulTerms(left).filter((term) => rightTerms.has(term))),
  ];
}

export function referenceTokenScore(
  ist: IstTransaction,
  bank: BankTransaction,
): number {
  const bankText = compactText(
    [
      bank.bankRef,
      bank.description,
      bank.customerReference,
      bank.dynamicsEntry,
      bank.clientName,
      bank.supplierBeneficiary,
      bank.cashFlow,
    ].join(' '),
  );
  if (!bankText) return 0;

  let best = 0;
  for (const token of ist.referenceTokens) {
    const normalized = normalizeReference(token);
    if (!normalized) continue;
    if (/^\d+$/.test(normalized) && normalized.length < 5) continue;
    if (bankText.includes(normalized)) return 1;
    if (normalized.length >= 6) {
      const partial = [...bankText.matchAll(/[a-z0-9]{6,}/g)].some((match) => {
        const value = match[0];
        return value.includes(normalized) || normalized.includes(value);
      });
      if (partial) best = Math.max(best, 0.75);
    }
  }
  return best;
}

export function isAmountMatched(
  amount1: number | null,
  amount2: number | null,
  options: ReconciliationOptions,
): boolean {
  if (amount1 === null || amount2 === null) return false;

  const diff = Math.abs(amount1 - amount2);
  if (diff <= options.amountTolerance) return true;

  const maxDiff = Math.min(
    Math.max(amount1, amount2) * (options.amountTolerancePercent ?? 0.05),
    options.amountToleranceCap ?? 100,
  );
  if (diff <= maxDiff) return true;

  // 1% tax tolerance (either direction)
  if (Math.abs(amount1 * 0.99 - amount2) <= options.amountTolerance)
    return true;
  if (Math.abs(amount2 * 0.99 - amount1) <= options.amountTolerance)
    return true;

  // 2% tax tolerance (either direction)
  if (Math.abs(amount1 * 0.98 - amount2) <= options.amountTolerance)
    return true;
  if (Math.abs(amount2 * 0.98 - amount1) <= options.amountTolerance)
    return true;

  return false;
}

export function scoreCandidate(
  ist: IstTransaction,
  bank: BankTransaction,
  options: ReconciliationOptions,
): ScoredCandidate {
  let amountMatchStyle: 'exact' | 'percentage' | 'tax_1' | 'tax_2' | 'none' =
    'none';
  let amountScore = 0;

  if (ist.amount !== null && bank.amount !== null) {
    const diff = Math.abs(ist.amount - bank.amount);
    const maxDiffPercent = Math.min(
      Math.max(ist.amount, bank.amount) * options.amountTolerancePercent,
      options.amountToleranceCap,
    );

    if (diff <= options.amountTolerance) {
      amountScore = 1;
      amountMatchStyle = 'exact';
    } else if (diff <= maxDiffPercent) {
      amountScore = 1;
      amountMatchStyle = 'percentage';
    } else if (
      Math.abs(ist.amount * 0.99 - bank.amount) <= options.amountTolerance ||
      Math.abs(bank.amount * 0.99 - ist.amount) <= options.amountTolerance
    ) {
      amountScore = 1;
      amountMatchStyle = 'tax_1';
    } else if (
      Math.abs(ist.amount * 0.98 - bank.amount) <= options.amountTolerance ||
      Math.abs(bank.amount * 0.98 - ist.amount) <= options.amountTolerance
    ) {
      amountScore = 1;
      amountMatchStyle = 'tax_2';
    }
  }

  const bankDays = [bank.epochDay, bank.valueEpochDay].filter(
    (day): day is number => day !== null,
  );
  let dateScore = 0;
  if (ist.epochDay !== null && bankDays.length > 0) {
    const difference = Math.min(
      ...bankDays.map((day) => Math.abs(ist.epochDay! - day)),
    );
    if (difference === 0) {
      dateScore = 1;
    } else if (
      options.toleranceDays > 0 &&
      difference <= options.toleranceDays
    ) {
      if (difference <= 2) dateScore = 0.85;
      else dateScore = 0.75;
    }
  }

  const accountScore = accountCompatibility(
    ist.accountCode,
    bank.normalizedDynCode,
  );
  const directionScore =
    ist.direction !== null &&
    bank.direction !== null &&
    ist.direction === bank.direction
      ? 1
      : 0;
  const descriptionScore = textSimilarity(ist.searchText, bank.searchText);
  const referenceScore = referenceTokenScore(ist, bank);
  const partyScore = Math.max(
    textSimilarity(ist.partyText, bank.partyText),
    textSimilarity(ist.partyText, bank.description),
  );
  const normalizedHints = normalizeText(ist.hintText);
  const hintBonus =
    normalizedHints &&
    bank.normalizedRef &&
    normalizedHints.includes(bank.normalizedRef)
      ? 0.05
      : 0;
  const sharedTerms = sharedMeaningfulTerms(ist.searchText, bank.searchText);
  const score = clamp(
    amountScore * 0.3 +
      dateScore * 0.18 +
      accountScore * 0.13 +
      directionScore * 0.1 +
      referenceScore * 0.12 +
      descriptionScore * 0.09 +
      partyScore * 0.08 +
      hintBonus,
  );

  return {
    bank,
    score,
    amountScore,
    dateScore,
    accountScore,
    directionScore,
    referenceScore,
    descriptionScore,
    partyScore,
    hintBonus,
    sharedTerms,
    amountMatchStyle,
  };
}

export function decideScoredMatch(
  candidates: ScoredCandidate[],
  options: ReconciliationOptions,
): MatchResult {
  if (candidates.length === 0) {
    return {
      status: 'Unmatched',
      matchCase: 'No Candidate',
      confidence: 0,
      reason: 'No bank row met the configured date and amount tolerances.',
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (best.score < options.confidenceThreshold) {
    return {
      status: 'Needs Review',
      matchCase: 'Incorrect or Ambiguous Link',
      confidence: best.score,
      reason: `Best candidate scored ${best.score.toFixed(3)}, below threshold ${options.confidenceThreshold.toFixed(3)}.`,
      bank: best.bank,
    };
  }
  if (second && best.score - second.score < 0.05) {
    return {
      status: 'Needs Review',
      matchCase: 'Incorrect or Ambiguous Link',
      confidence: best.score,
      reason: `Top candidates are too close (${best.score.toFixed(3)} vs ${second.score.toFixed(3)}).`,
      bank: best.bank,
    };
  }
  const lacksIndependentEvidence =
    best.dateScore < 1 &&
    best.referenceScore < 0.75 &&
    best.descriptionScore < 0.18 &&
    best.partyScore < 0.18;

  // Strong party/description evidence can compensate for account mismatch
  const strongIndependentEvidence =
    best.referenceScore >= 0.75 ||
    best.descriptionScore >= 0.3 ||
    best.partyScore >= 0.3;

  if (best.amountScore !== 1 || best.directionScore !== 1) {
    return {
      status: 'Needs Review',
      matchCase: 'Incorrect or Ambiguous Link',
      confidence: best.score,
      reason: 'Amount or direction do not match exactly.',
      bank: best.bank,
    };
  }

  if (lacksIndependentEvidence && best.accountScore < 0.8) {
    return {
      status: 'Needs Review',
      matchCase: 'Incorrect or Ambiguous Link',
      confidence: best.score,
      reason:
        'Amount and direction align, but the date is not exact and no independent client/description evidence confirms the link.',
      bank: best.bank,
    };
  }

  // When account doesn't match but we have strong independent evidence, allow Matched
  if (best.accountScore < 0.8 && !strongIndependentEvidence) {
    return {
      status: 'Needs Review',
      matchCase: 'Incorrect or Ambiguous Link',
      confidence: best.score,
      reason: `Account mismatch (${best.accountScore.toFixed(2)}) with insufficient description/party evidence to confirm.`,
      bank: best.bank,
    };
  }

  const strict =
    best.amountScore === 1 &&
    best.dateScore > 0 &&
    best.directionScore === 1 &&
    best.accountScore >= 0.75 &&
    best.score >= options.confidenceThreshold;
  return {
    status: 'Matched',
    matchCase:
      strict && best.accountScore === 1
        ? 'Account + Date + Amount Match'
        : strict
          ? 'Date + Amount + Terms Match'
          : 'Fuzzy Probable Match',
    confidence: best.score,
    reason: [
      best.amountMatchStyle &&
      best.amountMatchStyle !== 'exact' &&
      best.amountMatchStyle !== 'none'
        ? `amount=${best.amountScore.toFixed(2)} (${best.amountMatchStyle})`
        : `amount=${best.amountScore.toFixed(2)}`,
      `date=${best.dateScore.toFixed(2)}`,
      `account=${best.accountScore.toFixed(2)}`,
      `direction=${best.directionScore.toFixed(2)}`,
      `reference=${best.referenceScore.toFixed(2)}`,
      `description=${best.descriptionScore.toFixed(2)}`,
      `party=${best.partyScore.toFixed(2)}`,
      best.sharedTerms.length
        ? `shared terms: ${best.sharedTerms.slice(0, 5).join(', ')}`
        : 'no shared terms',
    ].join('; '),
    bank: best.bank,
  };
}

export function accountCompatibility(
  istCode: string,
  bankCode: string,
): number {
  const ist = normalizeAccountCode(istCode);
  const bank = normalizeAccountCode(bankCode);
  if (!ist || !bank) return 0;
  if (ist === bank) return 1;

  const istParts = ist.split('-');
  const bankParts = bank.split('-');
  const sameBank = istParts[0] === bankParts[0];
  const sameCurrency = istParts[1] === bankParts[1];

  // Check if any currency segment matches (EG/US/EU/GB)
  const istCurr = istParts.find((p) => ['EG', 'US', 'EU', 'GB'].includes(p));
  const bankCurr = bankParts.find((p) => ['EG', 'US', 'EU', 'GB'].includes(p));
  const currencyMatch = istCurr && bankCurr && istCurr === bankCurr;

  // Check if IST code is contained within bank code or vice versa (e.g., "PSD-EG" in "AAIB-EG-CA" → EG matches)
  const partialMatch =
    currencyMatch ||
    (istParts.length >= 2 &&
      bankParts.length >= 2 &&
      istParts.some((p) => bankParts.includes(p)));

  if (sameBank && sameCurrency) return 0.8;
  if (sameBank) return 0.45;
  if (partialMatch && istParts[0].length <= 4 && bankParts[0].length >= 3)
    return 0.3;
  if (currencyMatch) return 0.25;
  return 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
