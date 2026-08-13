import { DynAccountReceivableLineModel } from '@/modules/accounts-receivable/models';
import { validateTermsOfPayment } from '@/modules/accounts-receivable/processors/validate-terms-of-payment';

describe('validateTermsOfPayment', () => {
  const validTerms = new Map<string, string>([
    ['0 days', '0 Days'],
    ['3 days', '3 Days'],
    ['7 days', '7 Days'],
    ['15 days', '15 Days'],
    ['30 days', '30 days'],
    ['45 days', '45 Days'],
    ['60 days', '60 Days'],
  ]);

  const createLine = (termsOfPayment: string) => {
    const line = new DynAccountReceivableLineModel();
    line.TermsOfPayment = termsOfPayment;
    return line;
  };

  it('adds an error when the payment term is not synced', () => {
    const line = createLine('58 Days');

    validateTermsOfPayment(line, validTerms);

    expect(line.GetErrors()).toEqual([
      "TermsOfPayment: The terms of payment '58 Days' does not exist in D365FO. Please sync Payment Terms from D365FO or use a valid term.",
    ]);
    expect(line.TermsOfPayment).toBe('58 Days');
  });

  it('canonicalizes a case-insensitive match to the D365FO Name', () => {
    const line = createLine('30 Days');

    validateTermsOfPayment(line, validTerms);

    expect(line.ErrorCount).toBe(0);
    expect(line.TermsOfPayment).toBe('30 days');
  });

  it('skips empty terms of payment', () => {
    const line = createLine('');

    validateTermsOfPayment(line, validTerms);

    expect(line.ErrorCount).toBe(0);
  });
});
