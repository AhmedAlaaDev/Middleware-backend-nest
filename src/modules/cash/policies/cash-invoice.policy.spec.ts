import {
  formatCashInboundInvoice,
  validateCashInboundInvoice,
} from './cash-invoice.policy';

describe('validateCashInboundInvoice', () => {
  it('does not error when no invoice was provided (optional)', () => {
    const lookupEntries = jest.fn();

    const error = validateCashInboundInvoice('', lookupEntries);

    expect(error).toBeNull();
    expect(lookupEntries).not.toHaveBeenCalled();
  });

  it('does not error when the invoice is undefined', () => {
    expect(validateCashInboundInvoice(undefined, jest.fn())).toBeNull();
  });

  it('errors when a provided invoice does not exist in D365FO', () => {
    const error = validateCashInboundInvoice(
      '000012345/INVOICE',
      () => undefined,
    );

    expect(error).toBe(
      'Free text invoice (000012345/INVOICE) not exists in D365FO',
    );
  });

  it('errors when a provided invoice exists but is not posted', () => {
    const error = validateCashInboundInvoice('000012345/INVOICE', () => [
      { isPosted: false },
    ]);

    expect(error).toBe(
      '(000012345/INVOICE) exists in D365FO but is not posted (IsPosted=No)',
    );
  });

  it('passes when a provided invoice exists and is posted', () => {
    const error = validateCashInboundInvoice('000012345/INVOICE', () => [
      { isPosted: false },
      { isPosted: true },
    ]);

    expect(error).toBeNull();
  });

  it('looks up using the trimmed, lower-cased invoice key', () => {
    const lookupEntries = jest.fn().mockReturnValue([{ isPosted: true }]);

    validateCashInboundInvoice('  000012345/INVOICE  ', lookupEntries);

    expect(lookupEntries).toHaveBeenCalledWith('000012345/invoice');
  });
});

describe('formatCashInboundInvoice (missing invoice format handling)', () => {
  it('formats an empty invoice as an empty string without throwing', () => {
    expect(formatCashInboundInvoice('')).toBe('');
    expect(formatCashInboundInvoice(undefined)).toBe('');
  });
});
