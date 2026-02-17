import { RawDataModel } from '@/modules/entry-processor/interfaces';

export class VendorFreightAdjustmentRawData {
  UniqueId: number;
  LINENUMBER: number;
  JOURNALBATCHNUMBER: string;
  JOURNALNAME: string;
  VOUCHER: string;
  TRANSDATE: string;
  ACCOUNTTYPE: 'Ledger' | 'Vend';
  ACCOUNTDISPLAYVALUE: string;
  DEFAULTDIMENSIONDISPLAYVALUE?: string;
  FINTAGDISPLAYVALUE: string;
  TEXT: string;
  DEBITAMOUNT: number;
  CREDITAMOUNT: number;
  CURRENCYCODE: string;
  EXCHANGERATE: number;
  OFFSETACCOUNTTYPE: string;
  OFFSETACCOUNTDISPLAYVALUE: string;
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE: string;
  OFFSETFINTAGDISPLAYVALUE: string;
  OFFSETTEXT: string;
  PREPAYMENT: string;
  SALESTAXGROUP?: string;
  ITEMSALESTAXGROUP?: string;
  ITEMWITHHOLDINGTAXGROUPCODE?: string;
  TAXEXEMPTNUMBER: string;
  ISWITHHOLDINGCALCULATIONENABLED: boolean;
  DOCUMENT: number;
  DOCUMENTDATE: string;
  DUEDATE: string;
  INVOICE: string;
  PAYMENTMETHOD: string;
  PAYMENTREFERENCE: string;
  CASHDISCOUNT: number;
  CASHDISCOUNTAMOUNT: number;
  CASHDISCOUNTDATE: string;
  EXCHANGERATESECONDARY: number;
  OVERRIDESALESTAX: string;
  PAYMENTID: string;
  QUANTITY: number;
  REPORTINGCURRENCYEXCHRATESECONDARY: number;
  REPORTINGCURRENCYEXCHRATE: string;
  REVERSEDATE: string;
  REVERSEENTRY: boolean;
  SALESTAXCODE: string;
  POSTINGPROFILE: string;
  POSTINGLAYER: string;
  ISPOSTED: boolean;
  ISVENDOR: boolean;
  ISLEDGER: boolean;

  constructor(data: RawDataModel) {
    Object.assign(this, {
      ...data,
      ISPOSTED: this.toBoolean(data?.ISPOSTED),
      ISWITHHOLDINGCALCULATIONENABLED: this.toBoolean(
        data?.ISWITHHOLDINGCALCULATIONENABLED,
      ),
      REVERSEENTRY: this.toBoolean(data?.REVERSEENTRY),
      ISVENDOR: this.lowerTrimed(data?.ACCOUNTTYPE) === 'vend',
      ISLEDGER: this.lowerTrimed(data?.ACCOUNTTYPE) === 'ledger',
      LINENUMBER: Number(data?.LINENUMBER),
      DOCUMENT: Number(data?.DOCUMENT),
    });
  }

  private toBoolean(value: string): boolean {
    return this.lowerTrimed(value) === 'yes';
  }

  private lowerTrimed(value: string): string {
    return value?.toLowerCase()?.trim();
  }
}
