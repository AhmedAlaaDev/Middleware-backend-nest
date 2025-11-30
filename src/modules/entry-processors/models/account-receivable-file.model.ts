import { AccountDimensionsModel } from './account-dimensions.model';

export class AccountReceivableFileModel {
  LINENUMBER?: number;
  JOURNALBATCHNUMBER?: string;
  JOURNALNAME?: string;
  DESCRIPTION?: string;
  VOUCHER?: string;
  TRANSDATE: Date;
  ACCOUNTTYPE?: string;
  ACCOUNTDISPLAYVALUE?: string;
  DEFAULTDIMENSIONDISPLAYVALUE?: string;
  FINTAGDISPLAYVALUE?: string;
  TEXT?: string;
  DEBITAMOUNT: number;
  CREDITAMOUNT: number;
  CURRENCYCODE?: string;
  EXCHANGERATE?: string;
  OFFSETACCOUNTTYPE?: string;
  OFFSETACCOUNTDISPLAYVALUE?: string;
  OFFSETDEFAULTDIMENSIONDISPLAYVALUE?: string;
  OFFSETFINTAGDISPLAYVALUE?: string;
  OFFSETTEXT?: string;
  PREPAYMENT?: string;
  SALESTAXGROUP?: string;
  ITEMSALESTAXGROUP?: string;
  TAXEXEMPTNUMBER?: string;
  ISWITHHOLDINGCALCULATIONENABLED?: string;
  ITEMWITHHOLDINGTAXGROUPCODE?: string;
  DOCUMENT?: string;
  DOCUMENTDATE?: Date;
  DUEDATE?: Date;
  INVOICE?: string;
  PAYMENTMETHOD?: string;
  PAYMENTREFERENCE?: string;
  CASHDISCOUNT?: number;
  CASHDISCOUNTAMOUNT?: number;
  CASHDISCOUNTDATE?: Date;
  EXCHANGERATESECONDARY?: string;
  OVERRIDESALESTAX?: string;
  PAYMENTID?: string;
  QUANTITY?: string;
  REPORTINGCURRENCYEXCHRATESECONDARY?: string;
  REPORTINGCURRENCYEXCHRATE?: string;
  REVERSEDATE?: Date;
  REVERSEENTRY?: string;
  SALESTAXCODE?: string;
  POSTINGPROFILE?: string;
  POSTINGLAYER?: string;
  ISPOSTED?: string;
  UniqueId: number;

  AccountDimensions?: AccountDimensionsModel;

  getFormattedInvoiceNumber(): string {
    if (!this.INVOICE) {
      return '000000000';
    }

    const numberPart = this.INVOICE.split('/')[0];
    const number = parseInt(numberPart, 10);

    if (!isNaN(number)) {
      return number.toString().padStart(9, '0');
    }

    return '000000000';
  }

  getLineNumber(): number {
    if (this.LINENUMBER !== undefined && this.LINENUMBER !== null) {
      return Math.floor(this.LINENUMBER);
    }
    throw new Error('LINENUMBER is null or not set.');
  }

  modifiedLocationHeaderDefaultDimensionDisplayValue(): string {
    if (!this.DEFAULTDIMENSIONDISPLAYVALUE) {
      return '';
    }
    return this.DEFAULTDIMENSIONDISPLAYVALUE.toLowerCase().replace('cai', '002');
  }

  getTaxGroup(): string {
    if (!this.SALESTAXGROUP || !this.ITEMSALESTAXGROUP) {
      return 'Non-Taxabl';
    }

    if (
      this.ITEMSALESTAXGROUP &&
      this.ITEMSALESTAXGROUP.includes('VAT-0%')
    ) {
      return 'Non-Taxabl';
    }

    return this.SALESTAXGROUP;
  }

  getTaxGroupItem(): string {
    if (!this.ITEMSALESTAXGROUP) {
      return '';
    }

    if (this.ITEMSALESTAXGROUP.includes('14%SUPPLIE')) {
      return 'VAT-14%';
    }

    if (this.ITEMSALESTAXGROUP.includes('14')) {
      return 'VAT-14%';
    }

    if (this.ITEMSALESTAXGROUP.includes('VAT-0%')) {
      return '';
    }

    return this.ITEMSALESTAXGROUP;
  }
}

