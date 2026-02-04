import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class VendorFreightDFOLine {
  header: IVendorFreightDFOHeader;
  LineNumber: number;
  DimensionModel: AccountDimensionsModel;

  LINENUMBER: string;
  JOURNALBATCHNUMBER: string;
  ACCOUNTTYPE: 'Vend' | 'Ledger';
  ACCOUNTDISPLAYVALUE: string;
  DEFAULTDIMENSIONDISPLAYVALUE?: string;
  COMPANY: string;
  CREDIT: number;
  DEBIT: number;
  CURRENCY: string;
  DATE: string;
  DESCRIPTION: string;
  DOCUMENT: number;
  DUEDATE: string;
  EXCHRATE: number;
  EXCHRATESECOND: number;
  FINTAGDISPLAYVALUE: any;
  INVOICE: string;
  INVOICEDATE: string;
  ISWITHHOLDINGTAXCALCULATE: string;
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
  REPORTINGCURRENCYEXCHRATE: number;
  SALESTAXGROUP: string;
  TAXEXEMPTNUMBER: string;
  TERMSOFPAYMENT: string;
  TRANSACTIONTYPE: string;
  VOUCHER: number | string;
  SourceIds: string[];

  constructor(data: VendorFreightDFOLine) {
    Object.assign(this, data);
  }
}

export class IVendorFreightDFOLine
  extends VendorFreightDFOLine
  implements DynDataModel
{
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: VendorFreightDFOLine) {
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

export class IVendorFreightDFOHeader {
  JOURNALBATCHNUMBER: string;
  DESCRIPTION: string;
  JOURNALNAME: string;
  OVERRIDESALESTAX: string;
  SALESTAXINCLUDED: string;

  constructor(data: IVendorFreightDFOHeader) {
    Object.assign(this, data);
  }
}
