import { DynAccountReceivableLineModel } from '@/modules/accounts-receivable/models';

export function validateTermsOfPayment(
  line: DynAccountReceivableLineModel,
  validTerms: Map<string, string>,
): void {
  const value = line.TermsOfPayment?.trim() ?? '';
  if (!value) return;

  const exactName = validTerms.get(value.toLowerCase());
  if (!exactName) {
    line.AddError(
      'TermsOfPayment',
      `The terms of payment '${value}' does not exist in D365FO. Please sync Payment Terms from D365FO or use a valid term.`,
    );
    return;
  }

  line.TermsOfPayment = exactName;
}
