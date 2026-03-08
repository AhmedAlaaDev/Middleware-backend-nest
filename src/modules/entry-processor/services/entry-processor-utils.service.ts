import { Injectable } from '@nestjs/common';

import {
  EntryDimensionsModel,
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';

@Injectable()
export class EntryProcessorUtilsService {
  /**
   * Returns the dimension segment as-is (no case normalization).
   * Callers apply .trim() when parsing. Preserves original values from the source file.
   */
  normalizeDimensionSegment(input: unknown): string {
    if (input === null || input === undefined) return '';
    if (typeof input !== 'string' && typeof input !== 'number') return '';
    return typeof input === 'string' ? input : String(input);
  }

  /**
   * Parses a pipe-separated dimension string into AccountDimensionsModel.
   */
  parseDimensionString(dimensionString?: string): EntryDimensionsModel {
    if (!dimensionString || !dimensionString.trim()) {
      return {
        mainAccount: undefined,
        costCenter: undefined,
        activityName: undefined,
        businessUnit: undefined,
        location: undefined,
        customer: undefined,
        subCustomer: undefined,
        vendor: undefined,
        subVendor: undefined,
        chargeType: undefined,
        salesMan: undefined,
        coordinatorMan: undefined,
        freightType: 'Payable',
        truckerType: undefined,
        truckNumber: undefined,
        direction: undefined,
        worker: undefined,
        fixedAsset: undefined,
        lease: undefined,
        bankAccount: undefined,
      };
    }

    const parts = dimensionString.split('|');

    return {
      mainAccount:
        parts.length > 0
          ? this.normalizeDimensionSegment(parts[0])?.trim()
          : undefined,
      costCenter:
        parts.length > 1
          ? this.normalizeDimensionSegment(parts[1])?.trim()
          : undefined,
      activityName:
        parts.length > 2
          ? this.normalizeDimensionSegment(parts[2])?.trim()
          : undefined,
      businessUnit:
        parts.length > 3
          ? this.normalizeDimensionSegment(parts[3])?.trim()
          : undefined,
      location:
        parts.length > 4
          ? String(parts[4]).toLowerCase().includes('cai')
            ? '002'
            : String(parts[4]).trim()
          : undefined,
      customer:
        parts.length > 5
          ? this.normalizeDimensionSegment(parts[5])?.trim()
          : undefined,
      subCustomer:
        parts.length > 6
          ? this.normalizeDimensionSegment(parts[6])?.trim()
          : undefined,
      vendor:
        parts.length > 7
          ? this.normalizeDimensionSegment(parts[7])?.trim()
          : undefined,
      subVendor:
        parts.length > 8
          ? this.normalizeDimensionSegment(parts[8])?.trim()
          : undefined,
      chargeType:
        parts.length > 9
          ? this.normalizeDimensionSegment(parts[9])?.trim()
          : undefined,
      salesMan:
        parts.length > 10
          ? this.normalizeDimensionSegment(parts[10])?.trim()
          : undefined,
      coordinatorMan:
        parts.length > 11
          ? this.normalizeDimensionSegment(parts[11])?.trim()
          : undefined,
      freightType:
        parts.length > 12 && this.normalizeDimensionSegment(parts[12])?.trim()
          ? this.normalizeDimensionSegment(parts[12])?.trim() || 'Payable'
          : 'Payable',
      truckerType:
        parts.length > 13
          ? this.normalizeDimensionSegment(parts[13])?.trim()
          : undefined,
      truckNumber:
        parts.length > 14
          ? this.normalizeDimensionSegment(parts[14])?.trim()
          : undefined,
      direction:
        parts.length > 15
          ? this.normalizeDimensionSegment(parts[15])?.trim()
          : undefined,
      worker:
        parts.length > 16
          ? this.normalizeDimensionSegment(parts[16])?.trim()
          : undefined,
      fixedAsset:
        parts.length > 17
          ? this.normalizeDimensionSegment(parts[17])?.trim()
          : undefined,
      lease:
        parts.length > 18
          ? this.normalizeDimensionSegment(parts[18])?.trim()
          : undefined,
      bankAccount:
        parts.length > 19
          ? this.normalizeDimensionSegment(parts[19])?.trim()
          : undefined,
    };
  }

  /**
   * Returns the number of pipe-separated segments in a dimension string.
   */
  getDimensionSegmentLength(dimensionString?: string | null): number {
    if (!dimensionString) {
      return 0;
    }
    return String(dimensionString).split('|').length;
  }

  /**
   * Returns true if the dimension segment length is allowed (19 or 20).
   */
  isValidDimensionSegmentLength(segmentLength: number): boolean {
    return segmentLength === 19 || segmentLength === 20;
  }

  /**
   * Converts AccountDimensionsModel to pipe-separated string.
   */
  toDimensionString(dimensionsModel: EntryDimensionsModel | null): string {
    if (!dimensionsModel) {
      return '';
    }

    const parts = [
      dimensionsModel.mainAccount,
      dimensionsModel.costCenter,
      dimensionsModel.activityName,
      dimensionsModel.businessUnit,
      dimensionsModel.location,
      dimensionsModel.customer,
      dimensionsModel.subCustomer,
      dimensionsModel.vendor,
      dimensionsModel.subVendor,
      dimensionsModel.chargeType,
      dimensionsModel.salesMan,
      dimensionsModel.coordinatorMan,
      dimensionsModel.freightType || 'Payable',
      dimensionsModel.truckerType,
      dimensionsModel.truckNumber,
      dimensionsModel.direction,
      dimensionsModel.worker,
      dimensionsModel.fixedAsset,
      dimensionsModel.lease,
      dimensionsModel.bankAccount,
    ];

    const normalize = (v: unknown) => {
      if (v === null || v === undefined) return '';
      if (typeof v !== 'string' && typeof v !== 'number') return '';
      const s = typeof v === 'string' ? v : String(v);
      return s.trim();
    };

    return parts.map((p) => normalize(p)).join('|');
  }

  /**
   * Converts AccountDimensionsModel to pipe-separated string with padding to required segments.
   */
  toDimensionStringWithSegments(
    dimensionsModel: EntryDimensionsModel | null,
    requiredSegments: number,
  ): string {
    const base = this.toDimensionString(dimensionsModel);
    const parts = (base ?? '').split('|');

    while (parts.length < requiredSegments) parts.push('');
    return parts.join('|');
  }

  /**
   * Converts various input types to Date or null.
   */
  toDate(input: unknown): Date | null {
    if (!input) return null;
    if (input instanceof Date) return input;
    if (typeof input === 'string') {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof input === 'number') {
      const ms = Math.round((input - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /**
   * Formats voucher number with prefix.
   */
  formatVoucherNumber(voucher: number, prefix: string): string {
    return `${prefix}-${String(voucher).padStart(9, '0')}`;
  }

  /**
   * Formats batch number with optional prefix.
   */
  formatBatchNumber(batch: number, prefix?: string): string {
    return `${prefix || 'Mesco'}-${String(batch).padStart(9, '0')}`;
  }

  /**
   * Formats FreeTextNumber as "9 digits/suffix" based on billing classification and invoice type.
   */
  formatFreeTextNumberWithSuffix(
    invoiceNumber: string,
    billingClassId: string,
    isCreditNote: boolean,
  ): string {
    let numberPart = invoiceNumber || '';
    numberPart = numberPart.split('/')?.shift()?.trim() || '';

    const number = parseInt(numberPart, 10);
    const paddedNumber = !isNaN(number)
      ? number.toString().padStart(9, '0')
      : '000000000';

    const normalizedBillingClass = (billingClassId || '').toLowerCase().trim();
    let suffix: string;

    if (isCreditNote) {
      switch (normalizedBillingClass) {
        case 'inv-fw':
        case 'of-fw':
        case 'or-fw':
          suffix = 'CN-FW';
          break;
        case 'inv-tr':
        case 'or-tr':
          suffix = 'CN-TR';
          break;
        default:
          suffix = 'CN-FW';
          break;
      }
    } else {
      switch (normalizedBillingClass) {
        case 'inv-fw':
        case 'inv-tr':
          suffix = 'Invoice';
          break;
        case 'of-fw':
          suffix = 'OF-FW';
          break;
        case 'or-fw':
          suffix = 'OR-FW';
          break;
        case 'or-tr':
          suffix = 'OR-TR';
          break;
        default:
          suffix = 'Invoice';
          break;
      }
    }

    return `${paddedNumber}/${suffix}`;
  }

  /**
   * Formats date to "Month Year" (e.g., "January 2025").
   */
  formatMonthYear(dateStr: string): string {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();

    return `${month} ${year}`;
  }

  /**
   * Converts an array of date strings to from/to range for getFreeTextInvoicesByInvoiceDateRange.
   * Returns a wide range: from first day of previous month to last day of next month (exclusive).
   * Example: dates in Jan 2026 → from 2025-12-01 to 2026-03-01 (exclusive, so includes Feb 2026).
   * Empty array returns from and to as the same instant so the range is empty.
   */
  toInvoiceDateRangeFromDateStrings(dateStrings: string[]): {
    from: string;
    to: string;
  } {
    if (!dateStrings?.length) {
      const now = new Date().toISOString();
      return { from: now, to: now };
    }
    const parsed = dateStrings
      .map((s) => (typeof s === 'string' ? s.trim() : String(s)))
      .filter(Boolean)
      .map((s) => new Date(s))
      .filter((d) => !isNaN(d.getTime()));
    if (parsed.length === 0) {
      const now = new Date().toISOString();
      return { from: now, to: now };
    }
    // Normalize to start-of-day UTC and dedupe by day
    const dayTimestamps = new Set(
      parsed.map((d) => {
        const day = new Date(d);
        day.setUTCHours(0, 0, 0, 0);
        return day.getTime();
      }),
    );
    const min = new Date(Math.min(...dayTimestamps));
    const max = new Date(Math.max(...dayTimestamps));

    // from = first day of previous month (relative to min date)
    const fromDate = new Date(min);
    fromDate.setUTCDate(1); // First day of min's month
    fromDate.setUTCMonth(fromDate.getUTCMonth() - 1); // Previous month
    fromDate.setUTCHours(0, 0, 0, 0);
    const from = fromDate.toISOString();

    // to = first day of month after next month (exclusive, so includes last day of next month)
    const toDate = new Date(max);
    toDate.setUTCDate(1); // First day of max's month
    toDate.setUTCMonth(toDate.getUTCMonth() + 2); // Two months ahead (next month + 1)
    toDate.setUTCHours(0, 0, 0, 0);
    const to = toDate.toISOString();

    return { from, to };
  }

  /**
   * Gets month key as YYYY-MM string.
   */
  toMonthKey(dateStr: string): string {
    if (!dateStr) return 'invalid-date';

    const d = new Date(dateStr);

    if (isNaN(d.getTime())) {
      return 'invalid-date';
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');

    return `${year}-${month}`;
  }

  /**
   * Formats document number to 8 digits.
   */
  formatDocumentNumber(docNumber: string): string {
    if (!docNumber || !docNumber.trim()) {
      return '00000000';
    }

    const parts = docNumber.split('/');
    const number = parseInt(parts[0], 10);

    if (!isNaN(number)) {
      return number.toString().padStart(8, '0');
    }

    return '00000000';
  }

  /**
   * Normalizes currency code to uppercase (D365FO requirement).
   */
  normalizeCurrencyCode(currency?: string | null): string {
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency code is required and must be a string');
    }
    const normalized = currency.trim().toUpperCase();
    if (normalized.length !== 3) {
      throw new Error(
        `Invalid currency code format: ${currency}. Must be 3 characters.`,
      );
    }
    return normalized;
  }

  /**
   * Normalizes company code to uppercase (D365FO requirement).
   */
  normalizeCompanyCode(company?: string | null): string {
    if (!company || typeof company !== 'string') {
      throw new Error('Company code is required and must be a string');
    }
    return company.trim().toUpperCase();
  }

  /**
   * Normalizes TransactionType enum value (D365FO expects "Vend").
   */
  normalizeTransactionType(transactionType?: string | null): string {
    if (!transactionType || typeof transactionType !== 'string') {
      return 'Vend';
    }
    const normalized = transactionType.trim();
    const mapping: Record<string, string> = {
      vendor: 'Vend',
      Vendor: 'Vend',
      VENDOR: 'Vend',
      vend: 'Vend',
      Vend: 'Vend',
    };
    return mapping[normalized.toLowerCase()] || normalized;
  }

  /**
   * Builds batch and voucher numbers for a list of lines.
   */
  updateBatchAndVoucher<T extends EntryDynDataModel>(options: {
    lines: T[];
    startBatchNumber: number;
    startVoucherNumber: number;
    maxLinesPerBatch?: number;
  }): T[] {
    const {
      lines,
      startBatchNumber,
      startVoucherNumber,
      maxLinesPerBatch = 1000,
    } = options;

    const invoiceMap = new Map<string, T[]>();
    for (const line of lines) {
      const uniqueId = String(line.SourceIds[0]);
      if (!invoiceMap.has(uniqueId)) {
        invoiceMap.set(uniqueId, []);
      }
      invoiceMap.get(uniqueId)!.push(line);
    }

    const updatedMap = new Map<string, T[]>();

    let currentBatchMonth: string | null = null;
    let currentBatchLineCount = 0;
    let currentBatchNumber = startBatchNumber;
    let currentVoucherNum = startVoucherNumber;

    let lineNumberInBatch = 1;

    for (const [uniqueId, lines] of invoiceMap.entries()) {
      if (!lines || lines.length === 0) {
        continue;
      }

      const headerLine = lines[0];
      const invoiceMonth = this.toMonthKey(
        headerLine.TransDate || headerLine.Date,
      );

      const invoiceLineCount = lines.length;
      const monthChanged = currentBatchMonth !== invoiceMonth;
      const wouldExceedLimit =
        currentBatchLineCount + invoiceLineCount > maxLinesPerBatch;

      // If month changes, or adding this invoice would exceed the max lines,
      // we start a new batch and reset line number.
      if (monthChanged || wouldExceedLimit) {
        if (currentBatchMonth !== null) {
          currentBatchNumber++;
        }
        currentBatchMonth = invoiceMonth;
        currentBatchLineCount = 0;
        lineNumberInBatch = 1;
      }

      const journalName = headerLine.JournalName;
      const formattedBatch = this.formatBatchNumber(currentBatchNumber);
      const formattedVoucher = this.formatVoucherNumber(
        currentVoucherNum,
        journalName,
      );

      const updatedLines: T[] = [];

      for (const line of lines) {
        const updatedLine: T = {
          ...line,
          JournalBatchNumber: formattedBatch,
          Voucher: formattedVoucher,
          LineNumber: lineNumberInBatch,
        };

        updatedLines.push(updatedLine);
        currentBatchLineCount++;
        lineNumberInBatch++;
      }

      // Move to next voucher for the next invoice
      currentVoucherNum++;

      updatedMap.set(uniqueId, updatedLines);
    }

    return Array.from(updatedMap.values()).flat();
  }

  /**
   * Checks if the invoice is balanced after FX conversion.
   */
  checkInvoiceBalancedAfterFx(
    invoiceMap: Map<string, EntryRawDataModel[]>,
    unbalancedUniqueIds: Set<string>,
  ): Set<string> {
    unbalancedUniqueIds.clear();

    for (const [uniqueId, lines] of invoiceMap) {
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of lines) {
        const currencyCode = (line.CURRENCYCODE ?? '').trim().toUpperCase();

        // Treat base-currency lines (EGP) as already in base, so FX factor = 1.
        // For foreign currencies, normalize inconsistent exchange rate scales:
        // - 47.65  → 47.65
        // - 4765   → 47.65  (divide by 100)
        // - 0.4765 → 47.65  (multiply by 100)
        let fxRate = 1;

        if (currencyCode !== 'EGP' && currencyCode) {
          let rate = Number(line.EXCHANGERATE) || 0;

          if (rate >= 1000) {
            rate = rate / 100;
          } else if (rate > 0 && rate < 0.1) {
            rate = rate * 100;
          }

          fxRate = rate || 1;
        }

        totalDebit += line.DEBITAMOUNT * fxRate;
        totalCredit += line.CREDITAMOUNT * fxRate;
      }

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        unbalancedUniqueIds.add(uniqueId);
      }
    }

    return unbalancedUniqueIds;
  }

  /**
   * Make invoice unique per UniqueId: first UniqueId keeps the invoice, duplicates get suffix _1, _2, ...
   */
  suffixDuplicateInvoices<T extends EntryRawDataModel>(rawDate: T[]): T[] {
    const normalizedInv = (inv: string) => inv?.toLowerCase().trim() ?? '';
    const invoiceToUniqueIds = new Map<string, number[]>();

    for (const line of rawDate) {
      const key = normalizedInv(line.INVOICE);
      if (!key) continue;
      let ids = invoiceToUniqueIds.get(key);
      if (!ids) {
        ids = [];
        invoiceToUniqueIds.set(key, ids);
      }
      if (!ids.includes(line.UniqueId)) ids.push(line.UniqueId);
    }

    for (const line of rawDate) {
      const key = normalizedInv(line.INVOICE);
      const uniqueIds = invoiceToUniqueIds.get(key);
      if (!uniqueIds || uniqueIds.length <= 1) continue;
      const index = uniqueIds.indexOf(line.UniqueId);
      if (index >= 1) {
        line.INVOICE = `${line.INVOICE}_${index}`;
      }
    }

    return rawDate;
  }
}
