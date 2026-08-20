import {
  formatCashInboundInvoice,
  validateCashInboundInvoice,
} from './cash-invoice.policy';

describe('validateCashInboundInvoice', () => {
  it('always returns null (invoice validation disabled for Cash-In)', () => {
    const lookupEntries = jest.fn();
    expect(validateCashInboundInvoice('', lookupEntries)).toBeNull();
    expect(validateCashInboundInvoice('000012345/INVOICE', lookupEntries)).toBeNull();
    expect(validateCashInboundInvoice(undefined, lookupEntries)).toBeNull();
  });
});

describe('formatCashInboundInvoice (missing invoice format handling)', () => {
  it('formats an empty invoice as an empty string without throwing', () => {
    expect(formatCashInboundInvoice('')).toBe('');
    expect(formatCashInboundInvoice(undefined)).toBe('');
  });
});
