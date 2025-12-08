import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

export class VendorTruckingAdjustmentRawData {
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

  TAXEXEMPTNUMBER: string;

  ISWITHHOLDINGCALCULATIONENABLED: boolean;

  DOCUMENT: number;
  DOCUMENTDATE: string;
  DUEDATE: string;

  INVOICE: string;
  PAYMENTMETHOD: string;

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

      // Numeric fields
      LINENUMBER: Number(data?.LINENUMBER),
      DOCUMENT: Number(data?.DOCUMENT),
      DEBITAMOUNT: Number(data?.DEBITAMOUNT),
      CREDITAMOUNT: Number(data?.CREDITAMOUNT),
      EXCHANGERATE: Number(data?.EXCHANGERATE),
      EXCHANGERATESECONDARY: Number(data?.EXCHANGERATESECONDARY),
      CASHDISCOUNT: Number(data?.CASHDISCOUNT),
      CASHDISCOUNTAMOUNT: Number(data?.CASHDISCOUNTAMOUNT),
      QUANTITY: Number(data?.QUANTITY),
      REPORTINGCURRENCYEXCHRATESECONDARY: Number(
        data?.REPORTINGCURRENCYEXCHRATESECONDARY,
      ),

      // Converted booleans
      ISPOSTED: this.toBoolean(data?.ISPOSTED),
      ISWITHHOLDINGCALCULATIONENABLED: this.toBoolean(
        data?.ISWITHHOLDINGCALCULATIONENABLED,
      ),
      REVERSEENTRY: this.toBoolean(data?.REVERSEENTRY),

      // Auto detection
      ISVENDOR: this.lowerTrimed(data?.ACCOUNTTYPE) === 'vend',
      ISLEDGER: this.lowerTrimed(data?.ACCOUNTTYPE) === 'ledger',
    });
  }

  private toBoolean(value: string): boolean {
    return this.lowerTrimed(value) === 'yes' || this.lowerTrimed(value) === 'no'
      ? this.lowerTrimed(value) === 'yes'
      : false;
  }

  private lowerTrimed(value: string): string {
    return value?.toLowerCase()?.trim();
  }
}
