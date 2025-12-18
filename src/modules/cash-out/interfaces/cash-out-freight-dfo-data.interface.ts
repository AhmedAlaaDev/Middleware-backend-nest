import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

/* ----------------------------- HEADER ----------------------------- */

export class CashOutFreightDFOHeader {
  JOURNALBATCHNUMBER: string; // Auto Generation
  CATEGORYPURPOSE: number; // static 0
  CHARGEBEARER: number; // static 0
  DESCRIPTION: string; // static "Vendor Payment  Freight January 2025"
  ISPOSTED: 'Yes' | 'No'; // static "No"
  JOURNALNAME: string; // static "P-Freight"
  LOCALINSTRUMENT: number; // static 0
  OVERRIDESALESTAX: 'Yes' | 'No'; // static "No"
  SERVICELEVEL: number; // static 0

  constructor(data: CashOutFreightDFOHeader) {
    Object.assign(this, data);
  }
}

/* ----------------------------- SETTLED ---------------------------- */

export class CashOutFreightDFOSettled {
  JOURNALLINECOMPANY: string; // static "M-P"
  JOURNALBATCHNUMBER: string; // auto
  JOURNALLINENUMBER: string; // auto
  INVOICENUMBER: string; // INVOICE
  INVOICECOMPANY: string; // static "M-P"
  INVOICEDUEDATE: string; // blank
  ACCOUNTDISPLAYVALUE: string; // ACCOUNTDISPLAYVALUE
  CASHDISCOUNTTOTAKEININVOICECURRENCY: number; // static 0
  INVOICEACCOUNT: string; // ACCOUNTDISPLAYVALUE
  INVOICETOPAYMENTCROSSRATE: number; // static 0
  SETTLEMENTAMOUNTININVOICECURRENCY: number; // CREDITAMOUNT
  SourceIds: string[] = [];

  constructor(data: CashOutFreightDFOSettled) {
    Object.assign(this, data);
  }
}

/* ------------------------------ LINE ------------------------------ */

export class CashOutFreightDFOLineBase {
  header: CashOutFreightDFOHeader;
  settled: CashOutFreightDFOSettled;
  LineNumber: number;

  DimensionModel: AccountDimensionsModel;

  JOURNALBATCHNUMBER: string; // auto
  LINENUMBER: string; // LINENUMBER

  ACCOUNTDISPLAYVALUE: string; // ACCOUNTDISPLAYVALUE
  ACCOUNTTYPE: string; // ACCOUNTTYPE

  BANKTRANSACTIONTYPE: string; // null -> empty string

  CALCULATEWITHHOLDINGTAX: 'Yes' | 'No'; // ISWITHHOLDINGCALCULATIONENABLED

  CATEGORYPURPOSE: string; // null -> empty string
  CENTRALBANKIMPORTDATE: string; // null -> empty string
  CENTRALBANKPURPOSECODE: string; // null -> empty string
  CENTRALBANKPURPOSETEXT: string; // null -> empty string
  CHARGEBEARER: string; // null -> empty string

  CHECKNUMBER: string; // PAYMENTREFERENCE
  COMPANY: string; // static "M-P"

  CREDITAMOUNT: number; // CREDITAMOUNT
  CURRENCYCODE: string; // CURRENCYCODE
  DEBITAMOUNT: number; // DEBITAMOUNT

  DEFAULTDIMENSIONSFORACCOUNTDISPLAYVALUE: string; // DEFAULTDIMENSIONDISPLAYVALUE
  DEFAULTDIMENSIONSFOROFFSETACCOUNTDISPLAYVALUE: string; // DEFAULTDIMENSIONDISPLAYVALUE

  ERRORCODEPAYMENT: string; // null -> empty string

  EXCHANGERATE: number; // EXCHANGERATE
  FINTAGDISPLAYVALUE: any; // FINTAGDISPLAYVALUE

  FULLPRIMARYREMITTANCEADDRESS: string; // null -> empty string

  ISPREPAYMENT: 'Yes' | 'No'; // static "No"

  ITEMWITHHOLDINGTAXGROUPCODE: string; // ITEMWITHHOLDINGTAXGROUPCODE

  LOCALINSTRUMENT: string; // null -> empty string

  MARKEDINVOICE: string; // INVOICE
  MARKEDINVOICECOMPANY: string; // static "M-P"

  NACHAIATFOREIGNEXCHANGEINDICATOR: string; // null -> empty string
  NACHAIATFOREIGNEXCHANGEREFERENCE: string; // null -> empty string
  NACHAIATFOREIGNEXCHANGEREFERENCEINDICATOR: string; // null -> empty string
  NACHAIATOFACSCREENINGINDICATOR: string; // null -> empty string
  NACHAIATOFACSECONDARYSCREENINGINDICATOR: string; // null -> empty string
  NACHAIATORIGINATINGDFIQUALIFIER: string; // null -> empty string
  NACHAIATRECEIVINGDFIQUALIFIER: string; // null -> empty string

  NEWJOURNALBATCHNUMBER: string; // null -> empty string

  OFFSETACCOUNTDISPLAYVALUE: string; // ACCOUNTDISPLAYVALUE
  OFFSETACCOUNTTYPE: string; // ACCOUNTTYPE
  OFFSETCOMPANY: string; // static "M-P"

  OFFSETFINTAGDISPLAYVALUE: string; // FINTAGDISPLAYVALUE
  OFFSETTRANSACTIONTEXT: string; // TEXT

  OVERRIDESALESTAX: string; // null -> empty string

  PAYMENTID: string; // UniqueId
  PAYMENTMETHODNAME: string; // PAYMENTMETHOD
  PAYMENTREFERENCE: string; // PAYMENTREFERENCE

  PAYMENTSPECIFICATION: string; // null -> empty string

  POSTDATEDCHECKBANKBRANCH: string; // null -> empty string
  POSTDATEDCHECKBANKNAME: string; // null -> empty string
  POSTDATEDCHECKCASHIERDISPLAYVALUE: string; // null -> empty string
  POSTDATEDCHECKISREPLACEMENTCHECK: string; // null -> empty string
  POSTDATEDCHECKMATURITYDATE: string; // null -> empty string
  POSTDATEDCHECKNUMBER: string; // null -> empty string
  POSTDATEDCHECKORIGINALCHECKNUMBER: string; // null -> empty string
  POSTDATEDCHECKREASONFORSTOP: string; // null -> empty string
  POSTDATEDCHECKRECEIVEDDATE: string; // null -> empty string
  POSTDATEDCHECKREPLACEMENTCOMMENTS: string; // null -> empty string
  POSTDATEDCHECKSALESPERSONDISPLAYVALUE: string; // null -> empty string
  POSTDATEDCHECKSTOPPAYMENT: string; // null -> empty string

  POSTINGPROFILE: string; // POSTINGPROFILE

  REMITTANCEADDRESSCITY: string; // null -> empty string
  REMITTANCEADDRESSCOUNTRY: string; // null -> empty string
  REMITTANCEADDRESSCOUNTRYISOCODE: string; // null -> empty string
  REMITTANCEADDRESSCOUNTY: string; // null -> empty string
  REMITTANCEADDRESSDESCRIPTION: string; // null -> empty string
  REMITTANCEADDRESSDISTRICTNAME: string; // null -> empty string
  REMITTANCEADDRESSLATITUDE: string; // null -> empty string
  REMITTANCEADDRESSLONGITUDE: string; // null -> empty string
  REMITTANCEADDRESSSTATE: string; // null -> empty string
  REMITTANCEADDRESSSTREET: string; // null -> empty string
  REMITTANCEADDRESSTIMEZONE: string; // null -> empty string
  REMITTANCEADDRESSVALIDFROM: string; // null -> empty string
  REMITTANCEADDRESSVALIDTO: string; // null -> empty string
  REMITTANCEADDRESSZIPCODE: string; // null -> empty string
  REMITTANCELOCATIONID: string; // null -> empty string

  REPORTINGCURRENCYEXCHRATE: string; // auto
  REPORTINGCURRENCYEXCHRATESECONDARY: string; // auto
  SECONDARYEXCHANGERATE: string; // auto

  SERVICELEVEL: string; // null -> empty string

  SETTLEVOUCHER: string; // auto

  TAXGROUP: string; // SALESTAXGROUP
  TAXITEMGROUP: string; // ITEMSALESTAXGROUP
  TAXWITHHOLDGROUP: string; // ITEMWITHHOLDINGTAXGROUPCODE

  THIRDPARTYBANKACCOUNTID: string; // null -> empty string

  TRANSACTIONDATE: string; // TRANSDATE
  TRANSACTIONTEXT: string; // TEXT

  USESALESTAXDIRECTIONFROMMAINACCOUNT: 'Yes' | 'No'; // static "No"

  VENDORNAME: string; // auto
  VOUCHER: string; // auto

  SourceIds: string[] = [];

  constructor(data: CashOutFreightDFOLineBase) {
    Object.assign(this, data);
  }
}

export class CashOutFreightDFOLine
  extends CashOutFreightDFOLineBase
  implements DynDataModel
{
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: CashOutFreightDFOLineBase) {
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
