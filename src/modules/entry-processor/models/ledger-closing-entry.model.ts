import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class LedgerClosingEntryModel {
  UniqueId: number;
  LINENUMBER?: string;
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
  EXCHANGERATE?: number;
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
  CASHDISCOUNT?: string;
  CASHDISCOUNTAMOUNT?: number;
  CASHDISCOUNTDATE?: Date;
  EXCHANGERATESECONDARY?: number;
  OVERRIDESALESTAX?: string;
  PAYMENTID?: string;
  QUANTITY?: number;
  REPORTINGCURRENCYEXCHRATESECONDARY?: number;
  REPORTINGCURRENCYEXCHRATE?: number;
  REVERSEDATE?: Date;
  REVERSEENTRY?: string;
  SALESTAXCODE?: string;
  POSTINGPROFILE?: string;
  POSTINGLAYER?: string;
  ISPOSTED?: string;

  AccountDimensions?: AccountDimensionsModel;

  getLineNumber(): number {
    if (this.LINENUMBER) {
      const parts = this.LINENUMBER.split('.');
      return parseInt(parts[0], 10);
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

