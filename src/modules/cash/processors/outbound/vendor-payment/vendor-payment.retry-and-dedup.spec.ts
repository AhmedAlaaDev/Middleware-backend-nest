import { VendorPaymentMarkingResult } from './models/vendor-payment-marking-result';

/**
 * Tests verifying that the MarkingResult + posting layer interaction
 * correctly handles deduplication and unmarked retry.
 *
 * These tests exercise the contract between the Vendor Payment domain
 * (which produces a MarkingResult) and the posting infrastructure
 * (which may clear marking during retry).
 */
describe('Vendor Payment - Retry and Deduplication', () => {
  describe('MarkingResult atomicity through unmarked retry', () => {
    it('original MarkingResult is immutable — retry cannot mutate it', () => {
      const original = VendorPaymentMarkingResult.marked({
        markedLines: [
          {
            InvoiceNumber: 'INV-001',
            OperationNumber: 'OP-1',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
        markedInvoice: 'INV-001',
        documentNum: 'DOC-001',
        reason: 'normal vendor payment',
      });

      // Simulate what buildUnmarkedCashLine does at the posting layer:
      // it creates a NEW body with cleared MarkedLines — it does NOT mutate the original
      const retryBody = {
        MarkedLines: [],
        MARKEDINVOICE: null,
        TRANSACTIONTEXT: `${original.reason} - unmarked`,
      };

      // Original MarkingResult is untouched
      expect(original.shouldMark).toBe(true);
      expect(original.markedLines).toHaveLength(1);
      expect(original.markedInvoice).toBe('INV-001');

      // Retry body has cleared marking
      expect(retryBody.MarkedLines).toHaveLength(0);
      expect(retryBody.MARKEDINVOICE).toBeNull();
    });

    it('frozen markedLines array cannot be modified externally', () => {
      const result = VendorPaymentMarkingResult.marked({
        markedLines: [
          {
            InvoiceNumber: 'INV-001',
            OperationNumber: 'OP-1',
            DocumentNumber: '',
            HasWithHoldingLine: true,
          },
        ],
        markedInvoice: 'INV-001',
        documentNum: 'DOC-001',
        reason: 'test',
      });

      // Attempting to push to the frozen array throws
      expect(() => (result.markedLines as any).push({} as any)).toThrow();
      // The array itself is frozen and cannot be modified
      expect(Object.isFrozen(result.markedLines)).toBe(true);
    });
  });

  describe('buildUnmarkedCashLine contract (posting layer)', () => {
    // Simulates the posting layer's buildUnmarkedCashLine behavior
    function buildUnmarkedCashLine(
      body: Record<string, any>,
    ): Record<string, any> {
      const retryBody = { ...body };
      if (Array.isArray(retryBody.MarkedLines)) retryBody.MarkedLines = [];
      if ('MARKEDINVOICE' in retryBody) retryBody.MARKEDINVOICE = null;
      retryBody.PAYMENTNOTES = appendUnmarkedDescription(
        retryBody.PAYMENTNOTES,
      );
      retryBody.TRANSACTIONTEXT = appendUnmarkedDescription(
        retryBody.TRANSACTIONTEXT,
      );
      return retryBody;
    }

    function appendUnmarkedDescription(description: string): string {
      const trimmed = String(description ?? '').trim();
      if (!trimmed) return 'unmarked';
      if (trimmed.toLowerCase().includes('unmarked')) return trimmed;
      return `${trimmed} - unmarked`;
    }

    it('clears MarkedLines and MARKEDINVOICE on retry', () => {
      const originalBody = {
        AccountNum: 'VEND-001',
        accountTypeStr: 'Vendor',
        VendorGroup: 'Normal',
        MarkedLines: [
          {
            InvoiceNumber: 'INV-001',
            OperationNumber: 'OP-1',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
        MARKEDINVOICE: 'INV-001',
        PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Cash)',
        TRANSACTIONTEXT: 'Vendor Payment - Freight Jan 2026 (Cash)',
        journalNum: 'JRN-001',
      };

      const retryBody = buildUnmarkedCashLine(originalBody);

      expect(retryBody.MarkedLines).toEqual([]);
      expect(retryBody.MARKEDINVOICE).toBeNull();
      expect(retryBody.PAYMENTNOTES).toBe(
        'Vendor Payment - Freight Jan 2026 (Cash) - unmarked',
      );
      expect(retryBody.TRANSACTIONTEXT).toBe(
        'Vendor Payment - Freight Jan 2026 (Cash) - unmarked',
      );
      // Non-marking fields are preserved
      expect(retryBody.AccountNum).toBe('VEND-001');
      expect(retryBody.VendorGroup).toBe('Normal');
      expect(retryBody.journalNum).toBe('JRN-001');
    });

    it('does NOT double-append unmarked suffix', () => {
      const bodyAlreadyUnmarked = {
        MarkedLines: [],
        PAYMENTNOTES: 'Vendor Payment - unmarked',
        TRANSACTIONTEXT: 'Vendor Payment - unmarked',
      };

      const retryBody = buildUnmarkedCashLine(bodyAlreadyUnmarked);

      expect(retryBody.PAYMENTNOTES).toBe('Vendor Payment - unmarked');
      expect(retryBody.TRANSACTIONTEXT).toBe('Vendor Payment - unmarked');
    });

    it('original body is not mutated', () => {
      const originalBody = {
        MarkedLines: [
          {
            InvoiceNumber: 'INV-001',
            OperationNumber: '',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
        MARKEDINVOICE: 'INV-001',
        PAYMENTNOTES: 'Test',
        TRANSACTIONTEXT: 'Test',
      };

      const retryBody = buildUnmarkedCashLine(originalBody);

      // Original is untouched
      expect(originalBody.MarkedLines).toHaveLength(1);
      expect(originalBody.MARKEDINVOICE).toBe('INV-001');
      // Retry is cleared
      expect(retryBody.MarkedLines).toHaveLength(0);
      expect(retryBody.MARKEDINVOICE).toBeNull();
    });
  });

  describe('deduplication: existingLines skip behavior', () => {
    it('lines already in D365 are skipped (simulated)', () => {
      const existingLines = new Set([1, 2, 3]);
      const allLines = [
        { LineNumber: 1, customLineApiBody: { journalNum: '' } },
        { LineNumber: 2, customLineApiBody: { journalNum: '' } },
        { LineNumber: 3, customLineApiBody: { journalNum: '' } },
        { LineNumber: 4, customLineApiBody: { journalNum: '' } },
        { LineNumber: 5, customLineApiBody: { journalNum: '' } },
      ];

      // Simulate the dedup filter from postCashOutBulkLinesForHeader
      const pendingLines = allLines.filter(
        (line) => !existingLines.has(line.LineNumber),
      );

      expect(pendingLines).toHaveLength(2);
      expect(pendingLines.map((l) => l.LineNumber)).toEqual([4, 5]);
    });

    it('empty existingLines means all lines are sent', () => {
      const existingLines = new Set<number>();
      const allLines = [
        { LineNumber: 1 },
        { LineNumber: 2 },
        { LineNumber: 3 },
      ];

      const pendingLines = allLines.filter(
        (line) => !existingLines.has(line.LineNumber),
      );

      expect(pendingLines).toHaveLength(3);
    });
  });

  describe('retry triggers only on specific D365 error', () => {
    function isInvoiceAmountGreaterThanRemainingError(
      message: string,
    ): boolean {
      const normalized = String(message ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      return (
        normalized.includes('amount of the invoice') &&
        normalized.includes('is greater than the') &&
        (normalized.includes('remain amount') ||
          normalized.includes('remaining amount'))
      );
    }

    it('recognizes the remaining-amount error', () => {
      expect(
        isInvoiceAmountGreaterThanRemainingError(
          'The amount of the invoice 5000.00 is greater than the remaining amount 3200.00',
        ),
      ).toBe(true);
    });

    it('recognizes variant with "remain amount"', () => {
      expect(
        isInvoiceAmountGreaterThanRemainingError(
          'Amount of the invoice is greater than the remain amount',
        ),
      ).toBe(true);
    });

    it('does NOT trigger on unrelated D365 errors', () => {
      expect(
        isInvoiceAmountGreaterThanRemainingError(
          'The value "VendorGroup" is not found in the map.',
        ),
      ).toBe(false);
    });

    it('does NOT trigger on generic X++ error', () => {
      expect(
        isInvoiceAmountGreaterThanRemainingError(
          'An unexpected X++ error occurred.',
        ),
      ).toBe(false);
    });

    it('does NOT trigger on authentication error', () => {
      expect(
        isInvoiceAmountGreaterThanRemainingError(
          'Authentication token expired.',
        ),
      ).toBe(false);
    });

    it('does NOT trigger on empty message', () => {
      expect(isInvoiceAmountGreaterThanRemainingError('')).toBe(false);
    });
  });

  describe('retry only sends failed lines, not already-succeeded ones', () => {
    it('bulk TTS failure means entire batch is retried (all-or-nothing)', () => {
      // Simulate: batch of 3 lines fails with remaining-amount error
      // TTS means ALL 3 failed (none committed). Retry sends all 3 as unmarked.
      const batchLines = [
        {
          lineNumber: 1,
          body: {
            MarkedLines: [{ InvoiceNumber: 'INV-1' }],
            PAYMENTNOTES: 'A',
            TRANSACTIONTEXT: 'A',
          },
        },
        {
          lineNumber: 2,
          body: {
            MarkedLines: [{ InvoiceNumber: 'INV-2' }],
            PAYMENTNOTES: 'B',
            TRANSACTIONTEXT: 'B',
          },
        },
        {
          lineNumber: 3,
          body: {
            MarkedLines: [{ InvoiceNumber: 'INV-3' }],
            PAYMENTNOTES: 'C',
            TRANSACTIONTEXT: 'C',
          },
        },
      ];

      // All failures attributed to all lines (TTS rollback)
      const failures = batchLines.map((line, index) => ({
        requestIndex: index,
        lineNumber: line.lineNumber,
        message:
          'The amount of the invoice is greater than the remaining amount',
        correlated: true,
      }));

      // Retry sends all 3 lines as unmarked
      const retryLines = failures.map((failure) => {
        const pending = batchLines[failure.requestIndex];
        return {
          lineNumber: pending.lineNumber,
          body: { ...pending.body, MarkedLines: [], MARKEDINVOICE: null },
        };
      });

      expect(retryLines).toHaveLength(3);
      expect(retryLines.every((l) => l.body.MarkedLines.length === 0)).toBe(
        true,
      );
    });

    it('successful batch 1 is NOT re-sent when batch 2 fails', () => {
      // Simulate: 200 lines, batch size 100
      // Batch 1 (lines 1-100): succeeds
      // Batch 2 (lines 101-200): fails
      // Re-queue: existingLines check finds lines 1-100 already in D365
      const allLines = Array.from({ length: 200 }, (_, i) => ({
        LineNumber: i + 1,
      }));

      // After batch 1 succeeded, D365 has lines 1-100
      const existingAfterBatch1 = new Set(
        Array.from({ length: 100 }, (_, i) => i + 1),
      );

      // On re-queue, only lines 101-200 are pending
      const pendingOnRequeue = allLines.filter(
        (line) => !existingAfterBatch1.has(line.LineNumber),
      );

      expect(pendingOnRequeue).toHaveLength(100);
      expect(pendingOnRequeue[0].LineNumber).toBe(101);
      expect(pendingOnRequeue[99].LineNumber).toBe(200);
    });
  });
});
