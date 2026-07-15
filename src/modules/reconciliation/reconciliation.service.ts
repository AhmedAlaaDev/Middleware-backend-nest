import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  AUDIT_COLUMNS,
  BANK_REQUIRED_COLUMNS,
  BankTransaction,
  IST_REQUIRED_COLUMNS,
  IstTransaction,
  MATCHING_RULES,
  MatchResult,
  ReconciliationOutput,
  ReconciliationOptions,
  ReconciliationReport,
  ReviewRecord,
  ScoredCandidate,
} from './types';
import {
  cellText,
  chooseAmount,
  currencyFromAccountCode,
  formatDate,
  meaningfulTerms,
  normalizeAccountCode,
  normalizeDate,
  normalizeReference,
  normalizeText,
  toEpochDay,
} from './utils/normalization';
import {
  accountCompatibility,
  decideScoredMatch,
  TwoWayReferenceMatcher,
  referenceTokenScore,
  scoreCandidate,
  textSimilarity,
} from './utils/matching';

@Injectable()
export class ReconciliationService {
  parseOptions(input: Record<string, unknown>): ReconciliationOptions {
    return {
      toleranceDays: this.numberOption(
        input.toleranceDays,
        3,
        0,
        31,
        'toleranceDays',
      ),
      amountTolerance: this.numberOption(
        input.amountTolerance,
        0.01,
        0,
        1_000_000,
        'amountTolerance',
      ),
      confidenceThreshold: this.numberOption(
        input.confidenceThreshold,
        0.75,
        0,
        1,
        'confidenceThreshold',
      ),
      audit: this.booleanOption(input.audit, true),
      allowManyToOne: this.booleanOption(input.allowManyToOne, false),
      forceAll: this.booleanOption(input.forceAll, true),
    };
  }

  async reconcile(
    istBuffer: Buffer,
    bankBuffer: Buffer,
    options: ReconciliationOptions,
  ): Promise<Buffer> {
    return (await this.reconcileWithReport(istBuffer, bankBuffer, options))
      .workbook;
  }

  async reconcileWithReport(
    istBuffer: Buffer,
    bankBuffer: Buffer,
    options: ReconciliationOptions,
  ): Promise<ReconciliationOutput> {
    let [istWorkbook, bankWorkbook] = await Promise.all([
      this.loadWorkbook(istBuffer, 'IST'),
      this.loadWorkbook(bankBuffer, 'Bank'),
    ]);

    // Temp sheet references to perform inspection
    let istSheetTemp =
      istWorkbook.getWorksheet('Sheet1') ?? istWorkbook.worksheets[0];
    let bankSheetTemp =
      bankWorkbook.getWorksheet('All banks') ??
      bankWorkbook.getWorksheet('Sheet1') ??
      bankWorkbook.worksheets[0];
    if (!istSheetTemp || !bankSheetTemp)
      throw new BadRequestException('One of the workbooks has no worksheets.');

    let istHeadersTemp = this.headerMap(istSheetTemp);
    let bankHeadersTemp = this.headerMap(bankSheetTemp);

    // Auto-detect and swap if user uploaded them in reverse
    const istScore1 = IST_REQUIRED_COLUMNS.filter((col) =>
      istHeadersTemp.has(col),
    ).length;
    const istScore2 = IST_REQUIRED_COLUMNS.filter((col) =>
      bankHeadersTemp.has(col),
    ).length;
    const bankScore1 = BANK_REQUIRED_COLUMNS.filter((col) =>
      istHeadersTemp.has(col),
    ).length;
    const bankScore2 = BANK_REQUIRED_COLUMNS.filter((col) =>
      bankHeadersTemp.has(col),
    ).length;

    if (istScore2 + bankScore1 > istScore1 + bankScore2) {
      const tempWb = istWorkbook;
      istWorkbook = bankWorkbook;
      bankWorkbook = tempWb;
    }

    // Now select worksheets correctly after swap detection has established the correct workbooks
    const istSheet =
      istWorkbook.getWorksheet('Sheet1') ?? istWorkbook.worksheets[0];
    const bankSheet =
      bankWorkbook.getWorksheet('All banks') ??
      bankWorkbook.getWorksheet('Sheet1') ??
      bankWorkbook.worksheets[0];
    if (!istSheet || !bankSheet)
      throw new BadRequestException('One of the workbooks has no worksheets.');

    const istHeaders = this.headerMap(istSheet);
    const bankHeaders = this.headerMap(bankSheet);

    this.validateHeaders(
      istHeaders,
      IST_REQUIRED_COLUMNS,
      'IST',
      istSheet.name,
    );
    this.validateHeaders(
      bankHeaders,
      BANK_REQUIRED_COLUMNS,
      'Bank',
      bankSheet.name,
    );

    const banks = this.readBankTransactions(bankSheet, bankHeaders);
    if (banks.length === 0)
      throw new BadRequestException(
        'The selected bank sheet contains no usable rows.',
      );

    const paymentReferenceColumn = istHeaders.get('PAYMENTREFERENCE')!;
    const notesColumn = this.prepareNotesColumn(istSheet);
    const auditStartColumn = this.prepareAuditColumns(istSheet, options.audit);
    const transactions: IstTransaction[] = [];
    const matches = new Map<number, MatchResult>();

    // 1. Read all IST transactions
    for (let rowNumber = 2; rowNumber <= istSheet.rowCount; rowNumber += 1) {
      const row = istSheet.getRow(rowNumber);
      if (!row.hasValues) continue;
      const ist = this.readIstTransaction(row, istHeaders);
      transactions.push(ist);
    }

    // 2. Build the TwoWayReferenceMatcher
    const referenceMatcher = new TwoWayReferenceMatcher(banks, transactions);
    const banksByDay = this.indexBanksByDay(banks);
    const usedBanks = new Set<number>();

    // 3. Process matches
    for (const ist of transactions) {
      const rowNumber = ist.excelRowNumber;
      if (ist.hasValidPaymentReference) {
        const existingBanks = referenceMatcher.find(
          [ist.paymentReference],
          rowNumber,
        );
        const bank = this.bestDirectCandidate(ist, existingBanks, options);
        matches.set(rowNumber, {
          status: bank ? 'Matched' : 'Needs Review',
          matchCase: 'Existing Reference Preserved',
          confidence: bank ? 1 : 0.5,
          reason: bank
            ? 'Existing non-placeholder PAYMENTREFERENCE was preserved and found in the bank report.'
            : 'Existing non-placeholder PAYMENTREFERENCE was preserved but was not found in the bank report.',
          bank,
        });
        if (bank && !options.allowManyToOne) usedBanks.add(bank.index);
        continue;
      }

      let match = this.directMatch(
        ist,
        referenceMatcher,
        usedBanks,
        options.allowManyToOne,
        options,
      );

      if (!match) {
        const candidates = this.candidatesFor(ist, banksByDay, options)
          .filter(
            (bank) => options.allowManyToOne || !usedBanks.has(bank.index),
          )
          .map((bank) => scoreCandidate(ist, bank, options));
        match = decideScoredMatch(candidates, options);
      }

      // Fallback matching if still unmatched
      if (match.status === 'Unmatched') {
        const fallbackCandidates = this.fallbackCandidatesFor(
          ist,
          banksByDay,
          options,
        )
          .filter(
            (bank) => options.allowManyToOne || !usedBanks.has(bank.index),
          )
          .map((bank) => scoreCandidate(ist, bank, options));
        const fallbackMatch = decideScoredMatch(fallbackCandidates, options);
        if (fallbackMatch.status !== 'Unmatched') {
          match = {
            ...fallbackMatch,
            status: 'Needs Review',
            reason: `Fallback amount match (no account compatibility, 30 days tolerance). ${fallbackMatch.reason}`,
          };
        }
      }

      matches.set(rowNumber, match);
      if (
        (match.status === 'Matched' || match.status === 'Needs Review') &&
        match.bank
      ) {
        usedBanks.add(match.bank.index);
      }
    }

    this.applyGroupedSettlementMatches(
      transactions,
      matches,
      banksByDay,
      usedBanks,
      options,
    );

    if (options.forceAll) {
      this.applyExhaustiveFallbackMatches(
        transactions,
        matches,
        banks,
        usedBanks,
        options,
      );
    }

    this.rebuildUsedBanks(matches, usedBanks, options);
    this.applyCashJournalMatches(
      transactions,
      matches,
      banksByDay,
      usedBanks,
      options,
    );

    let paymentReferencesFilled = 0;
    let forcedBankMatches = 0;
    let remainingBlankPaymentReferences = 0;
    const reviewRecords: ReviewRecord[] = [];
    const reportCounts = {
      matched: 0,
      preserved: 0,
      needsReview: 0,
      unmatched: 0,
    };
    for (const ist of transactions) {
      const row = istSheet.getRow(ist.excelRowNumber);
      const match = matches.get(ist.excelRowNumber)!;
      if (ist.hasValidPaymentReference) reportCounts.preserved += 1;

      const finalReference =
        (match.bank?.normalizedRef ? match.bank.bankRef : '') ||
        (ist.hasValidPaymentReference ? ist.paymentReference : '') ||
        '';
      // Fill PAYMENTREFERENCE for verified and explicit fallback cases.
      if (
        (match.status === 'Matched' || match.status === 'Needs Review') &&
        finalReference
      ) {
        if (!ist.hasValidPaymentReference) {
          row.getCell(paymentReferenceColumn).value = finalReference;
          paymentReferencesFilled += 1;
          if (match.matchCase === 'Forced Best Bank Match')
            forcedBankMatches += 1;

          if (match.status === 'Matched') {
            reportCounts.matched += 1;
          } else {
            reportCounts.needsReview += 1;
          }
        }
      } else if (match.status === 'Needs Review') {
        reportCounts.needsReview += 1;
      } else {
        reportCounts.unmatched += 1;
      }
      if (
        !ist.hasValidPaymentReference &&
        !normalizeReference(row.getCell(paymentReferenceColumn).value)
      ) {
        remainingBlankPaymentReferences += 1;
      }
      row.getCell(notesColumn).value = this.matchNote(ist, match);
      if (options.audit) this.writeAudit(row, auditStartColumn, match);
      if (match.status !== 'Matched' && reviewRecords.length < 2000) {
        reviewRecords.push(this.reviewRecord(ist, match));
      }
    }

    this.addMatchingRulesSheet(istWorkbook);

    // Capture unmatched bank transactions
    const unmatchedBanks = banks.filter((bank) => !usedBanks.has(bank.index));
    if (unmatchedBanks.length > 0) {
      const unmatchedSheet = istWorkbook.addWorksheet(
        'Unmatched Bank Transactions',
      );
      const headers = [
        'Bank Row Number',
        'Bank Ref',
        'Description',
        'Transaction Date',
        'Deposit',
        'Withdraw',
        'Client Name',
        'Supplier Beneficiary',
        'Cash Flow',
        'Customer Reference',
        'Dynamics Entry',
        'Dyn_Map.Dyn Code',
        'Currency',
      ];
      const headerRow = unmatchedSheet.getRow(1);
      headers.forEach((h, idx) => {
        headerRow.getCell(idx + 1).value = h;
      });
      headerRow.font = { bold: true };

      unmatchedBanks.forEach((bank, rowIndex) => {
        const row = unmatchedSheet.getRow(rowIndex + 2);
        row.getCell(1).value = bank.excelRowNumber;
        row.getCell(2).value = bank.bankRef;
        row.getCell(3).value = bank.description;
        row.getCell(4).value = bank.transactionDate
          ? formatDate(bank.transactionDate)
          : '';
        row.getCell(5).value =
          bank.direction === 'deposit' ? bank.amount : null;
        row.getCell(6).value =
          bank.direction === 'withdraw' ? bank.amount : null;
        row.getCell(7).value = bank.clientName;
        row.getCell(8).value = bank.supplierBeneficiary;
        row.getCell(9).value = bank.cashFlow;
        row.getCell(10).value = bank.customerReference;
        row.getCell(11).value = bank.dynamicsEntry;
        row.getCell(12).value = bank.dynCode;
        row.getCell(13).value = bank.currency;
      });

      unmatchedSheet.columns.forEach((col) => {
        col.width = 20;
      });
    }

    const report: ReconciliationReport = {
      summary: {
        totalRows: transactions.length,
        ...reportCounts,
        paymentReferencesFilled,
        forcedBankMatches,
        remainingBlankPaymentReferences,
        reviewRecordsReturned: reviewRecords.length,
        reviewRecordsTruncated:
          reportCounts.needsReview + reportCounts.unmatched >
          reviewRecords.length,
      },
      reviewRecords,
      unmatchedBankRecords: unmatchedBanks.slice(0, 1000),
    };
    return {
      workbook: Buffer.from(await istWorkbook.xlsx.writeBuffer()),
      report,
    };
  }

  private async loadWorkbook(
    buffer: Buffer,
    label: string,
  ): Promise<ExcelJS.Workbook> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Bank IST Reconciliation';
      workbook.modified = new Date();
      await workbook.xlsx.load(
        buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
      return workbook;
    } catch {
      throw new BadRequestException(
        `${label} file is not a valid readable Excel workbook.`,
      );
    }
  }

  private headerMap(sheet: ExcelJS.Worksheet): Map<string, number> {
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
      const header = cellText(cell.value).trim();
      if (header && !headers.has(header)) headers.set(header, column);
    });
    return headers;
  }

  private validateHeaders(
    headers: Map<string, number>,
    required: readonly string[],
    label: string,
    sheetName: string,
  ): void {
    const missing = required.filter((header) => !headers.has(header));
    if (missing.length) {
      throw new BadRequestException(
        `${label} sheet "${sheetName}" is missing required columns: ${missing.join(', ')}`,
      );
    }
  }

  private readBankTransactions(
    sheet: ExcelJS.Worksheet,
    headers: Map<string, number>,
  ): BankTransaction[] {
    const banks: BankTransaction[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;
      const bankRef = this.value(row, headers, 'bank Ref');
      const description = this.value(row, headers, 'Description');
      const clientName = this.value(row, headers, 'Client Name');
      const supplierBeneficiary = this.value(
        row,
        headers,
        'Supplier Beneficiary',
      );
      const cashFlow = this.value(row, headers, 'cash flow');
      const customerReference = this.value(row, headers, 'Customer reference');
      const dynamicsEntry = this.value(row, headers, 'Dynamics entery');
      const transactionDate = normalizeDate(
        this.rawValue(row, headers, 'Transaction date'),
      );
      const valueDate = normalizeDate(
        this.rawValue(row, headers, 'Value date'),
      );
      const deposit = chooseAmount(
        this.rawValue(row, headers, 'Deposit'),
        null,
      );
      const withdraw = chooseAmount(
        this.rawValue(row, headers, 'Withdraw'),
        null,
      );
      const amount = deposit ?? withdraw;
      const direction =
        deposit !== null ? 'deposit' : withdraw !== null ? 'withdraw' : null;
      const dynCode = this.value(row, headers, 'Dyn_Map.Dyn code');
      const currency = this.value(row, headers, 'Currency').toUpperCase();
      if (!bankRef && !description && !transactionDate && amount === null)
        continue;
      const normalizedRef = normalizeReference(bankRef);
      banks.push({
        index: banks.length,
        excelRowNumber: rowNumber,
        bankRef,
        normalizedRef,
        compactRef: normalizedRef.replace(/\s+/g, ''),
        description,
        clientName,
        supplierBeneficiary,
        cashFlow,
        customerReference,
        dynamicsEntry,
        transactionDate,
        valueDate,
        epochDay: toEpochDay(transactionDate),
        valueEpochDay: toEpochDay(valueDate),
        amount,
        direction,
        dynCode,
        normalizedDynCode: normalizeAccountCode(dynCode),
        currency,
        searchText: [
          description,
          cashFlow,
          customerReference,
          dynamicsEntry,
          bankRef,
        ].join(' '),
        partyText: [clientName, supplierBeneficiary].join(' '),
      });
    }
    return banks;
  }

  private readIstTransaction(
    row: ExcelJS.Row,
    headers: Map<string, number>,
  ): IstTransaction {
    const description = this.value(row, headers, 'DESCRIPTION');
    const mainAccount = this.value(row, headers, 'Main Account');
    const voucher = this.value(row, headers, 'VOUCHER');
    const uniqueId = this.value(row, headers, 'UniqueId');
    const journalName = this.value(row, headers, 'JOURNALNAME');
    const clientName = this.value(row, headers, 'Client Name');
    const customer = this.value(row, headers, 'Customer');
    const operationNo = this.value(row, headers, 'Operation No');
    const document = this.value(row, headers, 'DOCUMENT');
    const invoice = this.value(row, headers, 'INVOICE');
    const paymentReference = this.value(row, headers, 'PAYMENTREFERENCE');
    const quotationNo = this.value(row, headers, 'Quotation No');
    const mbl = this.value(row, headers, 'MBL');
    const containerNo = this.value(row, headers, 'Container No');
    const hbl = this.value(row, headers, 'HBL');
    const voyageNo = this.value(row, headers, 'Voyage No');
    const vesselName = this.value(row, headers, 'Vessel Name');
    const locations =
      this.value(row, headers, 'Locations') ||
      this.value(row, headers, 'Location');
    const safeType = this.value(row, headers, 'SafeType');
    const transactionDate = normalizeDate(
      this.rawValue(row, headers, 'TRANSDATE'),
    );
    const debit = chooseAmount(this.rawValue(row, headers, 'DEBIT'), null);
    const credit = chooseAmount(this.rawValue(row, headers, 'CREDIT'), null);
    const accountCode = normalizeAccountCode(mainAccount || description);
    const currency =
      this.value(row, headers, 'CURRENCYCODE').toUpperCase() ||
      currencyFromAccountCode(accountCode);
    const referenceTokens = [
      paymentReference,
      operationNo,
      voucher,
      uniqueId,
      customer,
      quotationNo,
      mbl,
      containerNo,
      hbl,
      voyageNo,
      document,
      invoice,
    ]
      .map((value) => value.trim())
      .filter(
        (value, index, values) =>
          normalizeReference(value) && values.indexOf(value) === index,
      );
    return {
      excelRowNumber: row.number,
      description,
      mainAccount,
      voucher,
      uniqueId,
      journalName,
      clientName,
      customer,
      operationNo,
      document,
      invoice,
      paymentReference,
      quotationNo,
      mbl,
      containerNo,
      hbl,
      voyageNo,
      vesselName,
      locations,
      safeType,
      transactionDate,
      epochDay: toEpochDay(transactionDate),
      amount: debit ?? credit,
      direction:
        debit !== null ? 'deposit' : credit !== null ? 'withdraw' : null,
      accountCode,
      currency,
      hasValidPaymentReference: normalizeReference(paymentReference) !== '',
      directSearchTexts: [
        description,
        document,
        invoice,
        paymentReference,
        operationNo,
        voucher,
        uniqueId,
        customer,
        quotationNo,
        mbl,
        containerNo,
        hbl,
        voyageNo,
      ],
      searchText: [
        description,
        journalName,
        safeType,
        operationNo,
        voucher,
        uniqueId,
        customer,
        document,
        invoice,
        paymentReference,
        quotationNo,
        mbl,
        containerNo,
        hbl,
        voyageNo,
        vesselName,
        locations,
      ].join(' '),
      partyText: [clientName, customer].join(' '),
      hintText: referenceTokens.join(' '),
      referenceTokens,
    };
  }

  private directMatch(
    ist: IstTransaction,
    matcher: TwoWayReferenceMatcher,
    usedBanks: Set<number>,
    allowManyToOne: boolean,
    options: ReconciliationOptions,
  ): MatchResult | null {
    const allMatches = matcher.find(ist.directSearchTexts, ist.excelRowNumber);
    const available = allMatches.filter(
      (bank) =>
        Boolean(bank.normalizedRef) &&
        (allowManyToOne || !usedBanks.has(bank.index)),
    );
    const best = this.bestDirectCandidate(ist, available, options);
    if (best) {
      return {
        status: 'Matched',
        matchCase: 'Direct Reference Match',
        confidence: 1,
        reason:
          available.length > 1
            ? 'Exact reference found; duplicate bank rows were resolved using account, direction, amount, and date.'
            : 'An IST reference-bearing field contains the exact bank reference.',
        bank: best,
      };
    }
    if (allMatches.length > 0) {
      return {
        status: 'Needs Review',
        matchCase: 'Incorrect or Ambiguous Link',
        confidence: 1,
        reason:
          'The exact bank reference is already assigned to another IST row.',
      };
    }
    return null;
  }

  private indexBanksByDay(
    banks: BankTransaction[],
  ): Map<number, BankTransaction[]> {
    const index = new Map<number, BankTransaction[]>();
    for (const bank of banks) {
      for (const day of new Set([bank.epochDay, bank.valueEpochDay])) {
        if (day === null) continue;
        const rows = index.get(day) ?? [];
        rows.push(bank);
        index.set(day, rows);
      }
    }
    return index;
  }

  private candidatesFor(
    ist: IstTransaction,
    banksByDay: Map<number, BankTransaction[]>,
    options: ReconciliationOptions,
  ): BankTransaction[] {
    if (ist.epochDay === null || ist.amount === null) return [];
    const candidates: BankTransaction[] = [];
    const seen = new Set<number>();
    for (
      let offset = -options.toleranceDays;
      offset <= options.toleranceDays;
      offset += 1
    ) {
      for (const bank of banksByDay.get(ist.epochDay + offset) ?? []) {
        if (
          !seen.has(bank.index) &&
          Boolean(bank.normalizedRef) &&
          bank.amount !== null &&
          Math.abs(ist.amount - bank.amount) <= options.amountTolerance &&
          ist.direction !== null &&
          bank.direction === ist.direction &&
          (!ist.currency || !bank.currency || ist.currency === bank.currency)
        ) {
          const acctOk =
            accountCompatibility(ist.accountCode, bank.normalizedDynCode) >=
            0.3;
          const clientOk =
            textSimilarity(ist.partyText, bank.partyText) >= 0.3 ||
            textSimilarity(ist.partyText, bank.description) >= 0.3;
          const referenceOk = referenceTokenScore(ist, bank) >= 0.75;
          if (acctOk || clientOk || referenceOk) {
            seen.add(bank.index);
            candidates.push(bank);
          }
        }
      }
    }
    return candidates;
  }

  private fallbackCandidatesFor(
    ist: IstTransaction,
    banksByDay: Map<number, BankTransaction[]>,
    options: ReconciliationOptions,
  ): BankTransaction[] {
    if (ist.epochDay === null || ist.amount === null) return [];
    const candidates: BankTransaction[] = [];
    const seen = new Set<number>();
    const tolerance = Math.max(options.toleranceDays, 30);
    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      for (const bank of banksByDay.get(ist.epochDay + offset) ?? []) {
        if (
          !seen.has(bank.index) &&
          Boolean(bank.normalizedRef) &&
          bank.amount !== null &&
          Math.abs(ist.amount - bank.amount) <= options.amountTolerance &&
          ist.direction !== null &&
          bank.direction === ist.direction
        ) {
          const clientOk =
            ist.partyText &&
            bank.partyText &&
            (textSimilarity(ist.partyText, bank.partyText) >= 0.2 ||
              textSimilarity(ist.partyText, bank.description) >= 0.2);
          const referenceOk = referenceTokenScore(ist, bank) >= 0.75;
          if (clientOk || referenceOk) {
            seen.add(bank.index);
            candidates.push(bank);
          }
        }
      }
    }

    // If no candidates found with client/reference evidence, fall back to pure amount+date matching.
    if (candidates.length === 0) {
      for (let offset = -tolerance; offset <= tolerance; offset += 1) {
        for (const bank of banksByDay.get(ist.epochDay + offset) ?? []) {
          if (
            !seen.has(bank.index) &&
            Boolean(bank.normalizedRef) &&
            bank.amount !== null &&
            Math.abs(ist.amount - bank.amount) <= options.amountTolerance &&
            ist.direction !== null &&
            bank.direction === ist.direction
          ) {
            seen.add(bank.index);
            candidates.push(bank);
          }
        }
      }
    }

    return candidates;
  }

  private bestDirectCandidate(
    ist: IstTransaction,
    candidates: BankTransaction[],
    options: ReconciliationOptions,
  ): BankTransaction | undefined {
    if (candidates.length === 0) return undefined;
    return [...candidates]
      .map((bank) => ({ bank, scored: scoreCandidate(ist, bank, options) }))
      .sort((left, right) => {
        const leftExact =
          left.scored.amountScore +
          left.scored.directionScore +
          left.scored.accountScore +
          left.scored.dateScore;
        const rightExact =
          right.scored.amountScore +
          right.scored.directionScore +
          right.scored.accountScore +
          right.scored.dateScore;
        return rightExact - leftExact || right.scored.score - left.scored.score;
      })[0].bank;
  }

  private applyGroupedSettlementMatches(
    transactions: IstTransaction[],
    matches: Map<number, MatchResult>,
    banksByDay: Map<number, BankTransaction[]>,
    usedBanks: Set<number>,
    options: ReconciliationOptions,
  ): void {
    const groups = new Map<string, IstTransaction[]>();
    for (const ist of transactions) {
      const current = matches.get(ist.excelRowNumber);
      if (
        ist.hasValidPaymentReference ||
        !current ||
        current.status === 'Matched' ||
        current.matchCase === 'Cash Journal Amount + Date Match' ||
        ist.epochDay === null ||
        ist.amount === null ||
        ist.direction === null
      ) {
        continue;
      }
      const normalizedClient = normalizeText(ist.clientName);
      if (!ist.accountCode && !normalizedClient) continue;
      const key = [
        ist.epochDay,
        ist.accountCode || 'NO_ACCOUNT',
        ist.direction,
        normalizedClient,
      ].join('|');
      const rows = groups.get(key) ?? [];
      rows.push(ist);
      groups.set(key, rows);
    }

    for (const group of groups.values()) {
      if (group.length < 2 || group.length > 50) continue;
      const total = group.reduce((sum, row) => sum + (row.amount ?? 0), 0);
      const anchor = group[0];
      const candidates: BankTransaction[] = [];
      const seen = new Set<number>();
      for (
        let offset = -options.toleranceDays;
        offset <= options.toleranceDays;
        offset += 1
      ) {
        for (const bank of banksByDay.get(anchor.epochDay! + offset) ?? []) {
          if (
            seen.has(bank.index) ||
            !bank.normalizedRef ||
            (!options.allowManyToOne && usedBanks.has(bank.index)) ||
            bank.direction !== anchor.direction ||
            bank.amount === null ||
            Math.abs(total - bank.amount) > options.amountTolerance ||
            (anchor.currency &&
              bank.currency &&
              anchor.currency !== bank.currency)
          ) {
            continue;
          }
          const accountScore = accountCompatibility(
            anchor.accountCode,
            bank.normalizedDynCode,
          );
          const partyScore = Math.max(
            textSimilarity(anchor.partyText, bank.partyText),
            textSimilarity(anchor.partyText, bank.description),
          );
          const descriptionScore = textSimilarity(
            group.map((row) => row.searchText).join(' '),
            bank.searchText,
          );
          const referenceScore = Math.max(
            ...group.map((row) => referenceTokenScore(row, bank)),
          );
          if (
            accountScore < 0.3 &&
            partyScore < 0.2 &&
            descriptionScore < 0.18 &&
            referenceScore < 0.75
          ) {
            continue;
          }
          seen.add(bank.index);
          candidates.push(bank);
        }
      }
      const refs = new Set(
        candidates.map((bank) => bank.normalizedRef).filter(Boolean),
      );
      if (candidates.length === 0 || refs.size !== 1) continue;
      const bank = this.bestDirectCandidate(anchor, candidates, options)!;
      const result: MatchResult = {
        status: 'Matched',
        matchCase: 'Grouped Settlement Match',
        confidence: 0.95,
        reason: `${group.length} IST rows share date, direction, and ${
          anchor.accountCode
            ? 'account/client evidence'
            : 'client or description evidence'
        }; their total ${total.toFixed(2)} equals the real bank transaction.`,
        bank,
      };
      group.forEach((ist) => matches.set(ist.excelRowNumber, result));
      usedBanks.add(bank.index);
    }
  }

  private applyCashJournalMatches(
    transactions: IstTransaction[],
    matches: Map<number, MatchResult>,
    banksByDay: Map<number, BankTransaction[]>,
    usedBanks: Set<number>,
    options: ReconciliationOptions,
  ): void {
    for (const ist of transactions) {
      const current = matches.get(ist.excelRowNumber);
      if (
        ist.hasValidPaymentReference ||
        (current?.status === 'Matched' &&
          Boolean(current.bank?.normalizedRef)) ||
        !this.isCashJournal(ist) ||
        ist.epochDay === null ||
        ist.amount === null ||
        ist.direction === null
      ) {
        continue;
      }

      const cashMatch = this.cashJournalMatchFor(
        ist,
        banksByDay,
        usedBanks,
        options,
        current?.bank?.index,
      );
      if (!cashMatch?.bank) continue;
      if (
        current?.bank?.normalizedRef &&
        current.bank.index !== cashMatch.bank.index
      ) {
        continue;
      }
      matches.set(ist.excelRowNumber, cashMatch);
      if (!options.allowManyToOne) usedBanks.add(cashMatch.bank.index);
    }
  }

  private rebuildUsedBanks(
    matches: Map<number, MatchResult>,
    usedBanks: Set<number>,
    options: ReconciliationOptions,
  ): void {
    if (options.allowManyToOne) return;
    usedBanks.clear();
    for (const match of matches.values()) {
      if (
        (match.status === 'Matched' || match.status === 'Needs Review') &&
        match.bank?.normalizedRef
      ) {
        usedBanks.add(match.bank.index);
      }
    }
  }

  private cashJournalMatchFor(
    ist: IstTransaction,
    banksByDay: Map<number, BankTransaction[]>,
    usedBanks: Set<number>,
    options: ReconciliationOptions,
    currentBankIndex?: number,
  ): MatchResult | null {
    const candidates = this.cashJournalCandidatesFor(
      ist,
      banksByDay,
      usedBanks,
      options,
      currentBankIndex,
    );
    if (candidates.length !== 1) return null;

    const bank = candidates[0];
    const scored = this.forcedCandidateScore(ist, bank);
    const journal = this.cashJournalLabel(ist);
    const side =
      ist.direction === 'deposit' ? 'debit/deposit' : 'credit/withdraw';
    return {
      status: 'Needs Review',
      matchCase: 'Cash Journal Amount + Date Match',
      confidence: Math.max(0.9, scored.score),
      reason:
        `${journal} matched to one real bank row using exact ${side} amount ` +
        `${ist.amount!.toFixed(2)}, same direction, cash-like bank text, and ` +
        `${scored.dateDifference} day(s) date difference.`,
      bank,
    };
  }

  private cashJournalCandidatesFor(
    ist: IstTransaction,
    banksByDay: Map<number, BankTransaction[]>,
    usedBanks: Set<number>,
    options: ReconciliationOptions,
    currentBankIndex?: number,
  ): BankTransaction[] {
    if (ist.epochDay === null || ist.amount === null || ist.direction === null)
      return [];
    const candidates: BankTransaction[] = [];
    const seen = new Set<number>();
    const tolerance = Math.max(options.toleranceDays, 3);
    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      for (const bank of banksByDay.get(ist.epochDay + offset) ?? []) {
        if (
          seen.has(bank.index) ||
          !bank.normalizedRef ||
          bank.amount === null ||
          Math.abs(ist.amount - bank.amount) > options.amountTolerance ||
          bank.direction !== ist.direction ||
          (!ist.currency || !bank.currency
            ? false
            : ist.currency !== bank.currency) ||
          (!options.allowManyToOne &&
            usedBanks.has(bank.index) &&
            bank.index !== currentBankIndex) ||
          !this.isCashLikeBank(bank, ist.direction)
        ) {
          continue;
        }
        seen.add(bank.index);
        candidates.push(bank);
      }
    }
    return candidates;
  }

  private isCashJournal(ist: IstTransaction): boolean {
    const journal = this.cashJournalLabel(ist);
    return journal === 'CashIn' || journal === 'CashOut';
  }

  private cashJournalLabel(ist: IstTransaction): string {
    const text = normalizeText([ist.journalName, ist.description].join(' '));
    if (/\bcash\s*in\b|\bcashin\b/.test(text)) return 'CashIn';
    if (/\bcash\s*out\b|\bcashout\b/.test(text)) return 'CashOut';
    return '';
  }

  private isCashLikeBank(
    bank: BankTransaction,
    direction: Exclude<BankTransaction['direction'], null>,
  ): boolean {
    const text = normalizeText([bank.cashFlow, bank.description].join(' '));
    if (direction === 'deposit') {
      return /\bcash\s*deposit\b|\bbranch\s*deposit\b|\bcash\s*depo\b/.test(
        text,
      );
    }
    return (
      /\bcash\s*withdraw(?:al)?\b|\bbranch\s*withdraw(?:al)?\b/.test(text) ||
      /\bcheque\s*withdraw(?:al)?\b|\bchq\s*withdraw(?:al)?\b|\batm\b/.test(
        text,
      )
    );
  }

  private applyExhaustiveFallbackMatches(
    transactions: IstTransaction[],
    matches: Map<number, MatchResult>,
    banks: BankTransaction[],
    usedBanks: Set<number>,
    options: ReconciliationOptions,
  ): void {
    const aliases = this.learnAccountAliases(transactions, banks);
    const bankCodes = new Set(
      banks.map((bank) => bank.normalizedDynCode).filter(Boolean),
    );

    for (const ist of transactions) {
      const current = matches.get(ist.excelRowNumber);
      if (
        ist.hasValidPaymentReference ||
        (current?.status === 'Matched' && Boolean(current.bank?.normalizedRef))
      ) {
        continue;
      }

      const currentBankIndex = current?.bank?.index;

      const compatibleCodes = new Set<string>();
      if (bankCodes.has(ist.accountCode)) compatibleCodes.add(ist.accountCode);
      for (const code of aliases.get(ist.accountCode) ?? [])
        compatibleCodes.add(code);

      if (ist.amount === null || ist.direction === null) {
        matches.set(ist.excelRowNumber, {
          status: 'Unmatched',
          matchCase: 'No Candidate',
          confidence: 0,
          reason:
            'No real bank match was selected because the IST row is missing amount or debit/credit direction. PAYMENTREFERENCE was left blank.',
        });
        continue;
      }

      const istAmount = ist.amount;
      const istDirection = ist.direction;
      const compatibleCandidates = banks.filter(
        (bank) =>
          Boolean(bank.normalizedRef) &&
          bank.amount !== null &&
          Math.abs(istAmount - bank.amount) <= options.amountTolerance &&
          bank.direction === istDirection &&
          compatibleCodes.has(bank.normalizedDynCode) &&
          (!ist.currency || !bank.currency || ist.currency === bank.currency) &&
          (options.allowManyToOne ||
            !usedBanks.has(bank.index) ||
            bank.index === currentBankIndex),
      );

      let matchCase: MatchResult['matchCase'] | null = null;
      let fallbackCandidates =
        compatibleCandidates.length > 0
          ? ((matchCase = 'Forced Best Bank Match'), compatibleCandidates)
          : this.realBankFallbackCandidates(
              ist,
              banks,
              usedBanks,
              options,
              currentBankIndex,
            );
      if (!matchCase && fallbackCandidates.length > 0) {
        matchCase = 'Amount + Description Fallback Match';
      }

      if (fallbackCandidates.length === 0) {
        fallbackCandidates = this.nearAmountFallbackCandidates(
          ist,
          banks,
          usedBanks,
          options,
          currentBankIndex,
          compatibleCodes,
        );
        if (fallbackCandidates.length > 0) {
          matchCase = 'Near Amount + Client Match';
        }
      }

      if (fallbackCandidates.length === 0) {
        const accountText = compatibleCodes.size
          ? `compatible account(s) ${[...compatibleCodes].join(', ')}`
          : `IST account ${ist.accountCode || '(blank)'}`;
        matches.set(ist.excelRowNumber, {
          status: 'Unmatched',
          matchCase: 'No Candidate',
          confidence: 0,
          reason:
            `${accountText}: no unused real bank transaction had the required exact amount, direction, ` +
            'and supporting date/client/description evidence. PAYMENTREFERENCE was left blank.',
        });
        continue;
      }

      const ranked = fallbackCandidates
        .map((bank) => ({
          bank,
          ...this.forcedCandidateScore(ist, bank),
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.amountDifference - right.amountDifference ||
            left.dateDifference - right.dateDifference,
        );
      const best = ranked[0];
      const accountMatched = compatibleCodes.has(best.bank.normalizedDynCode);
      matches.set(ist.excelRowNumber, {
        status: 'Needs Review',
        matchCase:
          matchCase ??
          (accountMatched
            ? 'Forced Best Bank Match'
            : 'Amount + Description Fallback Match'),
        confidence: best.score,
        reason:
          'Selected an existing bank-sheet reference. ' +
          `Bank account=${best.bank.normalizedDynCode || '(blank)'}; ` +
          `amount difference=${best.amountDifference.toFixed(2)}; ` +
          `date difference=${best.dateDifference} day(s); ` +
          `direction=${best.bank.direction === ist.direction ? 'same' : 'different'}; ` +
          `reference token=${best.referenceScore.toFixed(2)}; ` +
          `client similarity=${best.partyScore.toFixed(2)}; description similarity=${best.descriptionScore.toFixed(2)}.`,
        bank: best.bank,
      });
      if (!options.allowManyToOne) usedBanks.add(best.bank.index);
    }
  }

  private realBankFallbackCandidates(
    ist: IstTransaction,
    banks: BankTransaction[],
    usedBanks: Set<number>,
    options: ReconciliationOptions,
    currentBankIndex?: number,
  ): BankTransaction[] {
    if (ist.amount === null || ist.direction === null) return [];
    const istAmount = ist.amount;
    const istDirection = ist.direction;
    return banks.filter((bank) => {
      if (
        !bank.normalizedRef ||
        bank.amount === null ||
        Math.abs(istAmount - bank.amount) > options.amountTolerance ||
        bank.direction !== istDirection ||
        (!ist.currency || !bank.currency
          ? false
          : ist.currency !== bank.currency) ||
        (!options.allowManyToOne &&
          usedBanks.has(bank.index) &&
          bank.index !== currentBankIndex)
      ) {
        return false;
      }

      const scored = this.forcedCandidateScore(ist, bank);
      const hasDateEvidence =
        scored.dateDifference <= Math.max(options.toleranceDays, 7);
      const hasTextEvidence =
        scored.referenceScore >= 0.75 ||
        scored.partyScore >= 0.2 ||
        scored.descriptionScore >= 0.18;
      const hasAccountEvidence =
        accountCompatibility(ist.accountCode, bank.normalizedDynCode) >= 0.25;
      return hasDateEvidence || hasTextEvidence || hasAccountEvidence;
    });
  }

  private nearAmountFallbackCandidates(
    ist: IstTransaction,
    banks: BankTransaction[],
    usedBanks: Set<number>,
    options: ReconciliationOptions,
    currentBankIndex: number | undefined,
    compatibleCodes: Set<string>,
  ): BankTransaction[] {
    if (ist.amount === null || ist.direction === null) return [];
    const istAmount = ist.amount;
    const istDirection = ist.direction;
    const maxDifference = Math.min(500, Math.max(10, istAmount * 0.005));

    return banks.filter((bank) => {
      if (
        !bank.normalizedRef ||
        bank.amount === null ||
        bank.direction !== istDirection ||
        (!ist.currency || !bank.currency
          ? false
          : ist.currency !== bank.currency) ||
        (!options.allowManyToOne &&
          usedBanks.has(bank.index) &&
          bank.index !== currentBankIndex)
      ) {
        return false;
      }

      const amountDifference = Math.abs(istAmount - bank.amount);
      if (
        amountDifference <= options.amountTolerance ||
        amountDifference > maxDifference
      ) {
        return false;
      }

      const scored = this.forcedCandidateScore(ist, bank);
      if (scored.dateDifference > Math.max(options.toleranceDays, 14))
        return false;

      const accountScore = accountCompatibility(
        ist.accountCode,
        bank.normalizedDynCode,
      );
      const accountEvidence =
        accountScore >= 0.75 ||
        compatibleCodes.has(bank.normalizedDynCode) ||
        (accountScore >= 0.25 && scored.referenceScore >= 0.75);
      const clientCoverage = this.clientTermCoverage(
        ist.partyText,
        [bank.partyText, bank.description].join(' '),
      );
      const strongTextEvidence =
        scored.referenceScore >= 0.75 ||
        clientCoverage >= 0.5 ||
        scored.partyScore >= 0.45;

      return accountEvidence && strongTextEvidence;
    });
  }

  private clientTermCoverage(client: string, bankText: string): number {
    const ignored = new Set(['egypt', 'misr', 'company', 'co', 'sae', 's.a.e']);
    const clientTerms = meaningfulTerms(client).filter(
      (term) => !ignored.has(term),
    );
    if (clientTerms.length === 0) return 0;
    const bankTerms = new Set(meaningfulTerms(bankText));
    const matched = clientTerms.filter((term) => bankTerms.has(term)).length;
    return matched / clientTerms.length;
  }

  private learnAccountAliases(
    transactions: IstTransaction[],
    banks: BankTransaction[],
  ): Map<string, Set<string>> {
    const banksByReference = new Map<string, BankTransaction[]>();
    for (const bank of banks) {
      if (!bank.normalizedRef || !bank.normalizedDynCode) continue;
      const rows = banksByReference.get(bank.normalizedRef) ?? [];
      rows.push(bank);
      banksByReference.set(bank.normalizedRef, rows);
    }

    const counts = new Map<string, Map<string, number>>();
    for (const ist of transactions) {
      if (!ist.hasValidPaymentReference || !ist.accountCode) continue;
      const reference = normalizeReference(ist.paymentReference);
      for (const bank of banksByReference.get(reference) ?? []) {
        const accountCounts =
          counts.get(ist.accountCode) ?? new Map<string, number>();
        accountCounts.set(
          bank.normalizedDynCode,
          (accountCounts.get(bank.normalizedDynCode) ?? 0) + 1,
        );
        counts.set(ist.accountCode, accountCounts);
      }
    }

    const aliases = new Map<string, Set<string>>();
    for (const [istCode, accountCounts] of counts) {
      const accepted = new Set<string>();
      for (const [bankCode, count] of accountCounts) {
        if (bankCode === istCode || count >= 2) accepted.add(bankCode);
      }
      if (accepted.size > 0) aliases.set(istCode, accepted);
    }
    return aliases;
  }

  private forcedCandidateScore(
    ist: IstTransaction,
    bank: BankTransaction,
  ): {
    score: number;
    amountDifference: number;
    dateDifference: number;
    partyScore: number;
    descriptionScore: number;
    referenceScore: number;
  } {
    const amountDifference =
      ist.amount === null || bank.amount === null
        ? Number.MAX_SAFE_INTEGER
        : Math.abs(ist.amount - bank.amount);
    const amountScale = Math.max(1, ist.amount ?? 0, bank.amount ?? 0);
    const relativeDifference = amountDifference / amountScale;
    const amountScore = 1 / (1 + relativeDifference * 12);

    const bankDays = [bank.epochDay, bank.valueEpochDay].filter(
      (day): day is number => day !== null,
    );
    const dateDifference =
      ist.epochDay === null || bankDays.length === 0
        ? 3650
        : Math.min(...bankDays.map((day) => Math.abs(ist.epochDay! - day)));
    const dateScore = 1 / (1 + dateDifference / 7);
    const partyScore = Math.max(
      textSimilarity(ist.partyText, bank.partyText),
      textSimilarity(ist.partyText, bank.description),
    );
    const descriptionScore = textSimilarity(ist.searchText, bank.searchText);
    const referenceScore = referenceTokenScore(ist, bank);
    const directionScore = ist.direction === bank.direction ? 1 : 0;
    const score = Math.max(
      0,
      Math.min(
        1,
        amountScore * 0.45 +
          dateScore * 0.25 +
          referenceScore * 0.12 +
          partyScore * 0.12 +
          descriptionScore * 0.06 +
          directionScore * 0.1,
      ),
    );
    return {
      score,
      amountDifference,
      dateDifference,
      partyScore,
      descriptionScore,
      referenceScore,
    };
  }

  private addMatchingRulesSheet(workbook: ExcelJS.Workbook): void {
    const existing = workbook.getWorksheet('Matching Rules');
    if (existing) workbook.removeWorksheet(existing.id);
    const sheet = workbook.addWorksheet('Matching Rules');
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns = [
      { header: 'Priority', key: 'priority', width: 11 },
      { header: 'Rule Name', key: 'name', width: 31 },
      { header: 'Matching Rule', key: 'rule', width: 92 },
      { header: 'MATCH_CASE', key: 'outputCase', width: 35 },
    ];
    MATCHING_RULES.forEach((rule) => sheet.addRow(rule));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF176F51' },
    };
    header.alignment = { vertical: 'middle' };
    sheet.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
    sheet.autoFilter = `A1:D${MATCHING_RULES.length + 1}`;
  }

  private reviewRecord(ist: IstTransaction, match: MatchResult): ReviewRecord {
    return {
      istRowNumber: ist.excelRowNumber,
      status: match.status,
      matchCase: match.matchCase,
      confidence: Number(match.confidence.toFixed(4)),
      reason: match.reason,
      description: ist.description,
      transactionDate: formatDate(ist.transactionDate),
      amount: ist.amount,
      direction: ist.direction,
      accountCode: ist.accountCode,
      clientName: ist.clientName,
      operationNo: ist.operationNo,
      document: ist.document,
      existingPaymentReference: ist.paymentReference,
      suggestedBankRef: match.bank?.bankRef ?? '',
      suggestedBankRowNumber: match.bank?.excelRowNumber ?? null,
      finalPaymentReference:
        match.bank?.bankRef ??
        (ist.hasValidPaymentReference ? ist.paymentReference : ''),
    };
  }

  private prepareNotesColumn(sheet: ExcelJS.Worksheet): number {
    const header = sheet.getRow(1);
    let existing = 0;
    header.eachCell({ includeEmpty: false }, (cell, column) => {
      if (cellText(cell.value).trim().toLowerCase() === 'notes')
        existing = column;
    });
    if (existing > 0) return existing;

    const column = sheet.columnCount + 1;
    const sourceStyle =
      sheet.columnCount > 0 ? header.getCell(sheet.columnCount).style : {};
    const cell = header.getCell(column);
    cell.value = 'notes';
    cell.style = { ...sourceStyle };
    sheet.getColumn(column).width = 78;
    header.commit();
    return column;
  }

  private matchNote(ist: IstTransaction, match: MatchResult): string {
    const rule = MATCHING_RULES.find(
      (item) => item.outputCase === match.matchCase,
    );
    const pieces = [
      `Rule: ${rule?.name ?? match.matchCase}`,
      `Case: ${match.matchCase}`,
      `Status: ${match.status}`,
      `Confidence: ${match.confidence.toFixed(4)}`,
    ];

    if (match.bank) {
      pieces.push(
        `Bank row: ${match.bank.excelRowNumber}`,
        `Bank reference: ${match.bank.bankRef}`,
      );
    } else if (ist.hasValidPaymentReference) {
      pieces.push(`Existing PAYMENTREFERENCE: ${ist.paymentReference}`);
    }

    if (rule) pieces.push(`Criteria: ${rule.rule}`);
    pieces.push(`Decision: ${match.reason}`);
    return pieces.join(' | ');
  }

  private prepareAuditColumns(
    sheet: ExcelJS.Worksheet,
    audit: boolean,
  ): number {
    if (!audit) return 0;
    const header = sheet.getRow(1);
    const headerValues = header.values;
    const existingStart = Array.isArray(headerValues)
      ? headerValues.findIndex(
          (value) => cellText(value).trim() === AUDIT_COLUMNS[0],
        )
      : -1;
    const hasCompleteAuditBlock =
      existingStart > 0 &&
      AUDIT_COLUMNS.every(
        (name, offset) =>
          cellText(header.getCell(existingStart + offset).value).trim() ===
          name,
      );
    const start = hasCompleteAuditBlock ? existingStart : sheet.columnCount + 1;
    const sourceStyle =
      sheet.columnCount > 0 ? header.getCell(sheet.columnCount).style : {};
    const widths = [16, 31, 18, 58, 18, 24, 52, 14];
    AUDIT_COLUMNS.forEach((name, offset) => {
      const cell = header.getCell(start + offset);
      cell.value = name;
      cell.style = { ...sourceStyle };
      sheet.getColumn(start + offset).width = widths[offset];
    });
    header.commit();
    return start;
  }

  private writeAudit(
    row: ExcelJS.Row,
    start: number,
    match: MatchResult,
  ): void {
    const values: unknown[] = [
      match.status,
      match.matchCase,
      Number(match.confidence.toFixed(4)),
      match.reason,
      match.bank?.excelRowNumber ?? null,
      match.bank?.bankRef ?? null,
      match.bank?.description ?? null,
      match.bank ? formatDate(match.bank.transactionDate) : null,
    ];
    values.forEach((value, offset) => {
      row.getCell(start + offset).value = value as ExcelJS.CellValue;
    });
  }

  private value(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    name: string,
  ): string {
    return cellText(this.rawValue(row, headers, name)).trim();
  }

  private rawValue(
    row: ExcelJS.Row,
    headers: Map<string, number>,
    name: string,
  ): unknown {
    const column = headers.get(name);
    return column ? row.getCell(column).value : null;
  }

  private numberOption(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    name: string,
  ): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(
        `${name} must be a number between ${min} and ${max}.`,
      );
    }
    return parsed;
  }

  private booleanOption(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }
}
