import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

/* ----------------------------- HEADER ----------------------------- */

export class CashInFreightDFOHeader {
  JOURNALBATCHNUMBER: string; // Auto Generation
  DESCRIPTION: string; // Customer Collection Freight January 2025
  ISPOSTED: 'Yes' | 'No';
  JOURNALNAME: string; // Cust-Pay
  OVERRIDESALESTAX: 'Yes' | 'No';

  constructor(data: CashInFreightDFOHeader) {
    Object.assign(this, data);
  }
}

/* ----------------------------- SETTLED ---------------------------- */

export class CashInFreightDFOSettled {
  JOURNALLINECOMPANY: string;
  JOURNALBATCHNUMBER: string;
  JOURNALLINENUMBER: string;

  INVOICENUMBER: string;
  INVOICECOMPANY: string;

  INVOICEDUEDATE: string;

  ACCOUNTDISPLAYVALUE: string;

  CASHDISCOUNTTOTAKEININVOICECURRENCY: number;

  INVOICEACCOUNT: string;

  INVOICETOPAYMENTCROSSRATE: number;

  SETTLEMENTAMOUNTININVOICECURRENCY: number;

  SourceIds: string[] = [];

  constructor(data: CashInFreightDFOSettled) {
    Object.assign(this, data);
  }
}

/* ------------------------------ LINE ------------------------------ */

class CashInFreightDFOLineBase {
  header: CashInFreightDFOHeader;
  settled: CashInFreightDFOSettled;
  LineNumber: number;

  DimensionModel: AccountDimensionsModel;

  JOURNALBATCHNUMBER: string; // Auto Generation
  LINENUMBER: string; // 1000 Rows Per Batch

  ACCOUNTDISPLAYVALUE: string;
  ACCOUNTTYPE: string; // "Customer" (أو Cust/Bank/Petty cash حسب نظامك)

  BANKTRANSACTIONTYPE: string;

  CALCULATEWITHHOLDINGTAX: 'Yes' | 'No';

  CENTRALBANKIMPORTDATE: string;
  CENTRALBANKPURPOSECODE: string;
  CENTRALBANKPURPOSETEXT: string;

  COMPANY: string; // M-P

  CREDITAMOUNT: number;
  CURRENCYCODE: string;

  CUSTOMERNAME: string; // Master Data (Auto)

  DEBITAMOUNT: number;

  DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: string;
  DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: string;

  DEPOSITNUMBER: string;

  EXCHANGERATE: number;

  FINTAGDISPLAYVALUE: any;

  ISPREPAYMENT: 'Yes' | 'No';

  ITEMWITHHOLDINGTAXGROUP?: string;

  MARKEDINVOICE: string;
  MARKEDINVOICECOMPANY: string;

  // NACHA fields
  NACHAIATFOREIGNEXCHANGEINDICATOR: string;
  NACHAIATFOREIGNEXCHANGEREFERENCE: string;
  NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: string;
  NACHAIATOFACSCREENINGINDICATOR: string;
  NACHAIATOFACSECONDARYSCREENINGINDICATOR: string;
  NACHAIATORIGINATINGDFIQUALIFIER: string;
  NACHAIATRECEIVINGDFIQUALIFIER: string;

  OFFSETACCOUNTDISPLAYVALUE: string;
  OFFSETACCOUNTTYPE: string;
  OFFSETCOMPANY: string;

  OFFSETFINTAGDISPLAYVALUE: string;
  OFFSETTRANSACTIONTEXT: string;

  OVERRIDESALESTAX: string;

  PAYMENTID: string;
  PAYMENTMETHODNAME: string;
  PAYMENTNOTES: string;
  PAYMENTREFERENCE: string;
  PAYMENTSPECIFICATION: string;

  // postdated check fields (اختياري)
  POSTDATEDCHECKBANKBRANCH: string;
  POSTDATEDCHECKBANKNAME: string;
  POSTDATEDCHECKCASHIERDISPLAYVALUE: string;
  POSTDATEDCHECKISREPLACEMENTCHECK: string;
  POSTDATEDCHECKMATURITYDATE: string;
  POSTDATEDCHECKNUMBER: string;
  POSTDATEDCHECKORIGINALCHECKNUMBER: string;
  POSTDATEDCHECKREASONFORSTOP: string;
  POSTDATEDCHECKRECEIVEDDATE: string;
  POSTDATEDCHECKREPLACEMENTCOMMENTS: string;
  POSTDATEDCHECKSALESPERSONDISPLAYVALUE: string;
  POSTDATEDCHECKSTOPPAYMENT: string;

  POSTINGPROFILE: string; // Cust-PP

  REPORTINGCURRENCYEXCHRATE: number | string;
  REPORTINGCURRENCYEXCHRATESECONDARY: number | string;

  SECONDARYEXCHANGERATE: string;
  SETTLEVOUCHER: string;

  TAXGROUP: string;
  TAXITEMGROUP: string;

  THIRDPARTYBANKACCOUNTID: string;

  TRANSACTIONDATE: string;
  TRANSACTIONTEXT: string; // AUTO
  VOUCHER: string; // AUTO

  USEABANKDEPOSITSLIP: string;
  USESALESTAXDIRECTIONFROMMAINACCOUNT: string;

  SourceIds: string[] = [];

  constructor(data: CashInFreightDFOLineBase) {
    Object.assign(this, data);
  }
}

export class CashInFreightDFOLine
  extends CashInFreightDFOLineBase
  implements DynDataModel
{
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: CashInFreightDFOLineBase) {
    super(data);
  }

  get ErrorCount(): number {
    return this.errors.length;
  }

  get ErrorsText(): string {
    if (this.errors.length === 0) return '';
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}
