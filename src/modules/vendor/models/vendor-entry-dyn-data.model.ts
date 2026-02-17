import {
  EntryDimensionsModel,
  EntryDynDataModel,
} from '@/modules/entry-processor/models';

export class VendorEntryDynDataModel extends EntryDynDataModel {
  // AMOUNTS
  /** Currency Code */
  Currency: string;
  /** Credit Amount */
  Credit: number;
  /** Debit Amount */
  Debit: number;

  /** Method of payment */
  MethodOfPayment: string;
  /** Payment id */
  PaymId: string;

  /** Is withholding tax calculate */
  IsWithholdingTaxCalculate: 'Yes' | 'No';

  TermsOfPayment: string;

  constructor(
    dimensionModel: EntryDimensionsModel,
    data: Partial<VendorEntryDynDataModel>,
  ) {
    super(data, dimensionModel);

    this.Currency = data.Currency || '';
    this.Credit = data.Credit || 0;
    this.Debit = data.Debit || 0;
    this.MethodOfPayment = data.MethodOfPayment || '';
    this.PaymId = data.PaymId || '';
    this.IsWithholdingTaxCalculate = data.IsWithholdingTaxCalculate || 'No';
    this.TermsOfPayment = data.TermsOfPayment || '';
  }
}
