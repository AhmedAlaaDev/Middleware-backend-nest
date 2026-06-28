import { type LookupCell } from '@/common/types';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

export type AccountReceivableFileLookupRow = Record<
  string,
  LookupCell<unknown>
>;

export class AccountReceivableFileModel {
  LINENUMBER?: number;
  JOURNALBATCHNUMBER?: string;
  JOURNALNAME?: string;
  DESCRIPTION?: string;
  VOUCHER?: string;
  TRANSDATE: Date;
  ACCOUNTTYPE?: string;
  ACCOUNTDISPLAYVALUE?: LookupCell<string | number>;
  DEFAULTDIMENSIONDISPLAYVALUE?: LookupCell<string | number>;
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
  DOCUMENTDATE: Date;
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

  AccountDimensions?: EntryDimensionsModel;

  static fromLookupRow(
    sourceRow: AccountReceivableFileLookupRow,
  ): AccountReceivableFileModel {
    const accountReceivableFile = new AccountReceivableFileModel();
    accountReceivableFile.assignLookupResults(sourceRow);
    return accountReceivableFile;
  }

  assignLookupResults(sourceRow: AccountReceivableFileLookupRow): void {
    for (const [propertyName, sourceCell] of Object.entries(sourceRow)) {
      (this as Record<string, unknown>)[propertyName] =
        this.lookupResultOrEmpty(sourceCell);
    }
  }

  private lookupResultOrEmpty(sourceCell?: LookupCell<unknown>): unknown {
    if (sourceCell === null || sourceCell === undefined) {
      return '';
    }

    if (typeof sourceCell === 'object' && 'result' in sourceCell) {
      const lookupResult = sourceCell.result;
      return lookupResult === null || lookupResult === undefined
        ? ''
        : lookupResult;
    }

    if (typeof sourceCell === 'object' && 'formula' in sourceCell) {
      return '';
    }

    return sourceCell;
  }

  private lookupResultAsString(
    sourceCell?: LookupCell<string | number>,
  ): string {
    const lookupResult = this.lookupResultOrEmpty(sourceCell);
    if (lookupResult === null || lookupResult === undefined) {
      return '';
    }
    if (typeof lookupResult === 'object') {
      return '';
    }
    if (typeof lookupResult === 'string') {
      return lookupResult;
    }
    if (typeof lookupResult === 'number') {
      return String(lookupResult);
    }

    return '';
  }

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
    const defaultDimensionDisplayValue = this.lookupResultAsString(
      this.DEFAULTDIMENSIONDISPLAYVALUE,
    );

    if (!defaultDimensionDisplayValue) {
      return '';
    }

    return defaultDimensionDisplayValue.toLowerCase().replace('cai', '002');
  }

  enrichedDefaultDimensionDisplayValue(
    dimensions: EntryDimensionsModel,
  ): string {
    return this.defaultDimensionFields
      .map((fieldName) => {
        if (!fieldName) return '';
        if (fieldName === 'freightType') {
          return this.dimensionPartAsString(
            dimensions.freightType || 'Payable',
          );
        }
        return this.dimensionPartAsString(dimensions[fieldName]);
      })
      .join('|');
  }

  private readonly defaultDimensionFields: Array<
    keyof EntryDimensionsModel | null
  > = [
    null,
    'costCenter',
    'activityName',
    'businessUnit',
    'location',
    'customer',
    'subCustomer',
    'vendor',
    'subVendor',
    'chargeType',
    'salesMan',
    'coordinatorMan',
    'freightType',
    'truckerType',
    'truckNumber',
    'direction',
    'worker',
    'fixedAsset',
    'lease',
    'bankAccount',
  ];

  private dimensionPartAsString(part: unknown): string {
    if (part === null || part === undefined) return '';
    if (typeof part !== 'string' && typeof part !== 'number') return '';
    return typeof part === 'string' ? part.trim() : String(part);
  }

  getTaxGroup(): string {
    if (!this.SALESTAXGROUP || !this.ITEMSALESTAXGROUP) {
      return 'Non-Taxabl';
    }

    if (this.ITEMSALESTAXGROUP && this.ITEMSALESTAXGROUP.includes('VAT-0%')) {
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
