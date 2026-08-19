import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';

export enum VendorPaymentSettlementIntent {
  MARKED = 'MARKED',
  UNMARKED = 'UNMARKED',
}

/**
 * Atomic result of the MarkedLines policy decision.
 *
 * Invariant: if shouldMark is true, markedLines MUST be non-empty and
 * markedInvoice MUST be populated. If shouldMark is false, markedLines
 * MUST be empty and markedInvoice MUST be empty.
 *
 * No downstream component may recompute or override these fields.
 */
export class VendorPaymentMarkingResult {
  readonly intent: VendorPaymentSettlementIntent;
  readonly markedLines: readonly CashEntryMarkedLine[];
  readonly markedInvoice: string;
  readonly documentNum: string;
  readonly reason: string;

  private constructor(data: {
    intent: VendorPaymentSettlementIntent;
    markedLines: CashEntryMarkedLine[];
    markedInvoice: string;
    documentNum: string;
    reason: string;
  }) {
    this.intent = data.intent;
    this.markedLines = Object.freeze(
      data.markedLines.map((line) => Object.freeze({ ...line })),
    );
    this.markedInvoice = data.markedInvoice;
    this.documentNum = data.documentNum;
    this.reason = data.reason;

    this.assertInvariant();
  }

  get shouldMark(): boolean {
    return this.intent === VendorPaymentSettlementIntent.MARKED;
  }

  private assertInvariant(): void {
    if (this.intent === VendorPaymentSettlementIntent.MARKED) {
      if (this.markedLines.length === 0) {
        throw new Error(
          `MarkingResult invariant violation: intent=MARKED but markedLines is empty. Reason: ${this.reason}`,
        );
      }
      if (!this.markedInvoice) {
        throw new Error(
          `MarkingResult invariant violation: intent=MARKED but markedInvoice is empty. Reason: ${this.reason}`,
        );
      }
    } else {
      if (this.markedLines.length > 0) {
        throw new Error(
          `MarkingResult invariant violation: intent=UNMARKED but markedLines is non-empty. Reason: ${this.reason}`,
        );
      }
      if (this.markedInvoice) {
        throw new Error(
          `MarkingResult invariant violation: intent=UNMARKED but markedInvoice="${this.markedInvoice}". Reason: ${this.reason}`,
        );
      }
    }
  }

  static marked(data: {
    markedLines: CashEntryMarkedLine[];
    markedInvoice: string;
    documentNum: string;
    reason: string;
  }): VendorPaymentMarkingResult {
    return new VendorPaymentMarkingResult({
      intent: VendorPaymentSettlementIntent.MARKED,
      ...data,
    });
  }

  static unmarked(data: {
    documentNum: string;
    reason: string;
  }): VendorPaymentMarkingResult {
    return new VendorPaymentMarkingResult({
      intent: VendorPaymentSettlementIntent.UNMARKED,
      markedLines: [],
      markedInvoice: '',
      ...data,
    });
  }
}
