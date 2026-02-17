import {
  EntryDimensionsModel,
  EntryDynDataModel,
} from '@/modules/entry-processor/models';

export class CashEntryDynDataModel extends EntryDynDataModel {
  /** Customer name */
  CustomerName: string;

  // AMOUNTS
  /** Currency Code */
  CurrencyCode: string;
  /** Credit Amount */
  CreditAmount: number;
  /** Debit Amount */
  DebitAmount: number;

  /** Payment method */
  PaymentMethod: string;
  /** Payment id */
  PaymentId: string;
  /** Payment reference */
  PaymentReference: string;

  /** Is withholding calculate */
  IsWithholdingCalculationEnabled: 'Yes' | 'No';

  constructor(
    dimensionModel: EntryDimensionsModel,
    data: Partial<CashEntryDynDataModel>,
  ) {
    super(data, dimensionModel);

    this.CustomerName = data.CustomerName || '';
    this.CurrencyCode = data.CurrencyCode || '';
    this.CreditAmount = data.CreditAmount || 0;
    this.DebitAmount = data.DebitAmount || 0;
    this.PaymentMethod = data.PaymentMethod || '';
    this.PaymentId = data.PaymentId || '';
    this.PaymentReference = data.PaymentReference || '';
    this.IsWithholdingCalculationEnabled =
      data.IsWithholdingCalculationEnabled || 'No';
  }
}
