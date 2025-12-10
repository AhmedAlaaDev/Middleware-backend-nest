import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

class VendorFreightAdjustmentDFOLine {
  header: IVendorFreightAdjustmentDFOHeader;
  LineNumber: number;
  DimensionModel: AccountDimensionsModel;

  JOURNALBATCHNUM: string;
  ACCOUNTTYPE: 'Vend' | 'Ledger';
  COMPANY: string;
  CREDIT: number;
  DEBIT: number;
  CURRENCY: string;
  DATE: string;
  DESCRIPTION: string;
  DOCUMENT: number;
  DUEDATE: string;
  EXCHANGERATE: number;
  EXCHANGERATESECOND: number;
  FINETAGDISPLAYVALUE: any;
  INVOICE: string;
  INVOICEDATE: string;
  ISWITHHOLDINGTAXCALCULATE: boolean;
  ITEMSALESTAXGROUP: string;
  ITEMWITHHOLDINGTAXGROUPCODE: string;
  METHODOFPAYMENT: string;
  OFFSETACCOUNTDISPLAYVALUE: string;
  OFFSETACCOUNTTYPE: string;
  OFFSETCOMPANY: string;
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE: string;
  OFFSETFINTAGDISPLAYVALUE: string;
  OFFSETTRANSACTIONTEXT: string;
  OVERRIDESALESTAX: string;
  PAYMID: number;
  POSTINGPROFILE: string;
  REPORTINGCURRENCYEXCHANGE: number;
  SALESTAXGROUP: string;
  TAXEXEMPTNUMBER: string;
  TERMSOFPAYMENT: string;
  TRANSACTIONTYPE: string;
  VOUCHER: number | string;
  SourceIds: string[];

  constructor(data: VendorFreightAdjustmentDFOLine) {
    Object.assign(this, data);
  }
}

export class IVendorFreightAdjustmentDFOLine
  extends VendorFreightAdjustmentDFOLine
  implements DynDataModel
{
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: VendorFreightAdjustmentDFOLine) {
    super(data);
  }

  get ErrorCount(): number {
    return this.errors.length;
  }

  get ErrorsText(): string {
    if (this.errors.length === 0) {
      return '';
    }
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}

export class IVendorFreightAdjustmentDFOHeader {
  JOURNALBATCHNUM: string;
  DESCRIPTION: string;
  ISPOSTED: boolean;
  JOURNALNAME: string;
  JOURNALTOTALCREDIT: number;
  JOURNALTOTALDEBIT: number;
  OVERSIDESALESTAX: boolean;
  SALESTAXINCLUDED: boolean;

  constructor(data: IVendorFreightAdjustmentDFOHeader) {
    Object.assign(this, data);
  }
}
