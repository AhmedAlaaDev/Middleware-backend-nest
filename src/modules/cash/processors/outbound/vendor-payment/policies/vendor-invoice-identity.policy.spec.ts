import {
  normalizeVendorInvoiceIdentity,
  vendorInvoiceIdentityEquals,
} from './vendor-invoice-identity.policy';

describe('vendor invoice identity', () => {
  it('matches an Excel invoice to the D365 year-suffixed value', () => {
    expect(vendorInvoiceIdentityEquals('178', '178 - 2026')).toBe(true);
  });

  it('keeps two explicit, different posting years distinct', () => {
    expect(vendorInvoiceIdentityEquals('178 - 2025', '178 - 2026')).toBe(false);
  });

  it('matches an Excel invoice to a D365 duplicate-sequence suffix', () => {
    expect(vendorInvoiceIdentityEquals('188', '188_1')).toBe(true);
  });

  it('keeps two explicit duplicate sequences distinct', () => {
    expect(vendorInvoiceIdentityEquals('188_1', '188_2')).toBe(false);
  });

  it('matches an Excel invoice to a D365 hyphen duplicate sequence', () => {
    expect(vendorInvoiceIdentityEquals('050', '050-1')).toBe(true);
    expect(vendorInvoiceIdentityEquals('088', '088-4')).toBe(true);
  });

  it('keeps two explicit hyphen duplicate sequences distinct', () => {
    expect(vendorInvoiceIdentityEquals('050-1', '050-2')).toBe(false);
  });

  it('normalizes case, spacing, and directional marks', () => {
    expect(normalizeVendorInvoiceIdentity('\u200e EMP_2  ')).toBe('emp_2');
  });

  it('does not match unrelated invoice text', () => {
    expect(vendorInvoiceIdentityEquals('178', '178A - 2026')).toBe(false);
  });
});
