import { DynDataModel } from '@/modules/entry-processor/interfaces';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

class VendorTruckingDFOLine {
  header: IVendorTruckingDFOHeader;
  LineNumber: number;
  SourceIds: string[];
  DimensionModel: EntryDimensionsModel;

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

  constructor(data: VendorTruckingDFOLine) {
    Object.assign(this, data);
  }
}

export class IVendorTruckingDFOLine
  extends VendorTruckingDFOLine
  implements DynDataModel
{
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: VendorTruckingDFOLine) {
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

export class IVendorTruckingDFOHeader {
  JOURNALBATCHNUMBER: string;
  DESCRIPTION: string;
  ISPOSTED: boolean;
  JOURNALNAME: string;
  JOURNALTOTALCREDIT: number;
  JOURNALTOTALDEBIT: number;
  OVERSIDESALESTAX: boolean;
  SALESTAXINCLUDED: boolean;

  constructor(data: IVendorTruckingDFOHeader) {
    Object.assign(this, data);
  }
}
