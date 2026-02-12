import { Injectable, Logger } from '@nestjs/common';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { DimensionKey } from '@/modules/entry-processor/types/dimension-key.type';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { GetTaxItemGroupHeadingsQuery } from '@/modules/master-data/queries/get-tax-item-group-headings.query';

@Injectable()
export class AccountReceivableFreightCreditNoteEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableFreightCreditNoteEntryProcessor.name,
  );
  readonly entryProcessorType =
    EntryProcessorTypes.AccountReceivableFreightCreditNote;
  readonly requiredDimensions: readonly DimensionKey[] = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
  ] as const;

  constructor(baseDeps: EntryProcessorBaseDependencies) {
    super({ dependencies: baseDeps });
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    _billingClassId?: string,
  ): Promise<DynDataModel[]> {
    const accounts = await this.getAccountCustomerInvoiceMappings(
      ServiceTypes.Freight,
    );
    const arData = this.mapToModels(data);
    const groups = this.groupByVoucherInvoice(arData);
    await this.primeFreightBillingClassifications(company);
    const results: DynAccountReceivableLineDto[] = [];
    for (const [, lines] of groups.entries()) {
      const enriched = this.enrichCreditNoteGroup(lines, accounts);
      results.push(...enriched);
    }
    return results;
  }

  private mapToModels(data: RawDataModel[]): AccountReceivableFileModel[] {
    return data.map((raw) => {
      const model = new AccountReceivableFileModel();
      Object.assign(model, raw);
      return model;
    });
  }

  private groupByVoucherInvoice(
    arData: AccountReceivableFileModel[],
  ): Map<string, AccountReceivableFileModel[]> {
    const groups = new Map<string, AccountReceivableFileModel[]>();
    for (const line of arData) {
      const key = `${line.VOUCHER || ''}_${line.INVOICE || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(line);
    }
    return groups;
  }

  private async primeFreightBillingClassifications(
    company: string,
  ): Promise<void> {
    const invRes = await this.queryBus.execute(
      new GetBillingCodesQuery({ company, billingClassification: 'INV-FW' }),
    );
    const orcRes = await this.queryBus.execute(
      new GetBillingCodesQuery({ company, billingClassification: 'OR-FW' }),
    );
    const ofRes = await this.queryBus.execute(
      new GetBillingCodesQuery({ company, billingClassification: 'OF-FW' }),
    );
    this.billingClassifications.set('inv-fw', invRes?.items ?? []);
    this.billingClassifications.set('or-fw', orcRes?.items ?? []);
    this.billingClassifications.set('of-fw', ofRes?.items ?? []);
  }

  private enrichCreditNoteGroup(
    lines: AccountReceivableFileModel[],
    accounts: any[],
  ): DynAccountReceivableLineDto[] {
    const custLines = lines
      .filter((l) => l.ACCOUNTTYPE?.toLowerCase() === 'cust')
      .sort((a, b) => {
        try {
          return a.getLineNumber() - b.getLineNumber();
        } catch {
          return 0;
        }
      });
    const ledgerLines = lines.filter(
      (l) => l.ACCOUNTTYPE?.toLowerCase() === 'ledger',
    );
    const out: DynAccountReceivableLineDto[] = [];
    let invLineCount = 1;
    for (const custLine of custLines) {
      for (const ledgerLine of ledgerLines) {
        const dims = this.parseDimensionString(
          ledgerLine.ACCOUNTDISPLAYVALUE || '',
        );
        this.applySubCustomerMapping(dims, accounts);
        ledgerLine.ACCOUNTDISPLAYVALUE = this.toDimensionString(dims);
        const classification =
          this.getInvoiceBillingClassificationCode(custLine);
        const codes =
          this.billingClassifications.get(
            classification?.toLowerCase() || '',
          ) || [];
        const billingCode = this.findBillingCode(codes, dims.chargeType);
        const arLine = this.prepareAccountReceivableLine(
          invLineCount,
          dims,
          custLine,
          ledgerLine,
          billingCode || null,
          classification || '',
        );
        out.push(arLine);
      }
      invLineCount++;
    }
    return out;
  }

  private buildSourceId(
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    lineNumber: number,
  ): string {
    if (custLine?.UniqueId !== undefined && custLine?.UniqueId !== null) {
      return String(custLine.UniqueId);
    }
    return `${custLine?.VOUCHER || ''}_${custLine?.INVOICE || ''}_${lineNumber}`;
  }

  private applySubCustomerMapping(
    dims: AccountDimensionsModel,
    accounts: Array<{ customerAccount?: string; invoiceAccount?: string }>,
  ): void {
    const matchingAccount = accounts.find((a) =>
      a.customerAccount
        ?.toLowerCase()
        .includes(dims.customer?.toLowerCase() || ''),
    );
    if (matchingAccount && dims.subCustomer) {
      const mappingAccount = accounts.find((a) =>
        a.customerAccount
          ?.toLowerCase()
          .includes(dims.subCustomer?.toLowerCase() || ''),
      );
      if (mappingAccount) {
        dims.subCustomer = mappingAccount.invoiceAccount;
      }
    }
  }

  private findBillingCode(
    billingCodes: IBillingCode[],
    chargeType?: string,
    billingClassification?: string,
  ): IBillingCode | null {
    if (!chargeType) return null;
    const lowerCharge = chargeType.toLowerCase();
    const lowerClass = billingClassification?.toLowerCase();
    let best: IBillingCode | null = null;
    for (const bc of billingCodes) {
      if (!bc.billingCode?.toLowerCase().includes(lowerCharge)) continue;
      if (lowerClass && bc.billingClassification?.toLowerCase() !== lowerClass)
        continue;
      const len = bc.billingCode?.length ?? 0;
      const bestLen = best?.billingCode?.length ?? 0;
      if (!best || len > bestLen) best = bc;
    }
    return best;
  }

  async validateAsync(
    data: DynDataModel[],
    company: string,
    _billingClassId?: string,
  ): Promise<DynDataModel[]> {
    const arData = data as DynAccountReceivableLineDto[];

    const chargeTypeDims: string[] = [];
    for (const billingCodes of this.billingClassifications.values()) {
      chargeTypeDims.push(
        ...billingCodes
          .map((bc: IBillingCode) => bc.billingCode)
          .filter((bc) => bc),
      );
    }
    const uniqueChargeTypeDims = Array.from(new Set(chargeTypeDims));

    const taxItemGroupRes = await this.queryBus.execute(
      new GetTaxItemGroupHeadingsQuery(
        { dataAreaId: company },
        undefined,
        10000,
      ),
    );
    const validTaxItemGroupCodes = new Set(
      taxItemGroupRes.items.map((x) => x.taxItemGroup),
    );

    for (const arLine of arData) {
      await this.dimensionService.validateDimensions(arLine, {
        requiredDimensions: this.requiredDimensions,
        validateMainAccount: true,
        chargeTypeDims: uniqueChargeTypeDims,
        validTaxItemGroupCodes,
        chartNumber: this.options?.chartNumber,
      });
    }
    this.procLogger.debug('data Validated');
    return data;
  }

  insertIntoDynamicsAsync(
    _data: DynDataModel[],
    _company: string,
  ): Promise<void> {
    // Not implemented for credit notes
    return Promise.reject(
      new Error('InsertIntoDynamicsAsync is not implemented for credit notes'),
    );
  }

  /**
   * Determines billing classification code from invoice/journal
   * Based on the journal name or invoice pattern
   */
  private getInvoiceBillingClassificationCode(
    custLine: AccountReceivableFileModel,
  ): string {
    const document = custLine.DOCUMENT?.toLowerCase() || '';

    // Check journal name first
    if (document.includes('invoice')) {
      return 'INV-FW';
    } else {
      return document.split('/').pop()?.trim()?.toUpperCase() || '';
    }
  }

  /**
   * Formats invoice number with CR or CN prefix based on billing classification
   */
  private formatInvoiceNumber(invNumber: string, billingClass: string): string {
    const parts = invNumber.split('-');
    if (parts.length < 2) {
      return invNumber;
    }

    const invoicePrefix = billingClass.toLowerCase() === 'or-fw' ? 'CR' : 'CN';
    const number = parseInt(parts[1], 10);

    if (!isNaN(number)) {
      return `${invoicePrefix}-${number.toString().padStart(5, '0')}`;
    }

    return invNumber;
  }

  /**
   * Prepares account receivable line for credit note
   * Uses negative amounts (credit note logic)
   */
  private prepareAccountReceivableLine(
    lineNumber: number,
    dimensions: AccountDimensionsModel,
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    billingCode: IBillingCode | null,
    billingClassId: string,
  ): DynAccountReceivableLineDto {
    const transDate = this.toDate(custLine.TRANSDATE) as Date;
    const dueDate = this.toDate(custLine.DUEDATE);
    const cashDiscountDate = this.toDate(custLine.CASHDISCOUNTDATE);

    const termsOfPaymentDays =
      dueDate && transDate
        ? Math.ceil(
            (dueDate.getTime() - transDate.getTime()) / (1000 * 60 * 60 * 24),
          )
        : 0;

    // For credit notes, use negative amounts
    const price =
      ledgerLine.ACCOUNTTYPE?.toLowerCase() === 'ledger'
        ? (ledgerLine.DEBITAMOUNT || 0) * -1
        : (ledgerLine.CREDITAMOUNT || 0) * -1;

    const line = new DynAccountReceivableLineDto();
    const sourceId = this.buildSourceId(custLine, ledgerLine, lineNumber);
    line.SourceIds = [sourceId];
    line.UniqueId =
      typeof custLine.UniqueId === 'number' ? custLine.UniqueId : lineNumber;
    line.CustomId =
      typeof custLine.UniqueId === 'number' ? custLine.UniqueId : lineNumber;
    line.LineNumber = lineNumber;
    line.FreeTextNumber = this.formatFreeTextNumberWithSuffix(
      custLine.INVOICE || '',
      billingClassId,
      true, // This is a credit note
    );
    line.DocumentDate = transDate;
    line.CustomerAccount = dimensions.subCustomer || '';
    line.HeaderDefaultDimensionDisplayValue =
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
    line.HeaderFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.InvoiceTxt = dimensions.chargeType || '';
    line.Description = custLine.TEXT || '';
    line.Quantity = 1;
    line.UnitPrice = price;
    line.AmountCur = price;
    line.CurrencyCode = ledgerLine.CURRENCYCODE || '';
    line.SalesTaxGroup = ledgerLine.getTaxGroup();
    line.SalesTaxItemGroup = ledgerLine.getTaxGroupItem();
    line.DefaultDimensionDisplayValue =
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
    line.LineFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.DueDate = dueDate || undefined;
    line.CashDiscountCode = '';
    line.CashDiscountDate = cashDiscountDate || undefined;
    line.CustomerReference = this.formatFreeTextNumberWithSuffix(
      custLine.INVOICE || '',
      billingClassId,
      true, // This is a credit note
    );
    line.EInvoiceIsLineSpecific = 'No';
    line.InclTax = 'Yes';
    line.InvoiceAccount = dimensions.customer || '';
    line.InvoiceDate = transDate || undefined;
    line.LedgerDimensionDisplayValue = dimensions.mainAccount || '';
    line.OverrideSalesTax = 'No';
    line.PostingProfile = 'Cust-PP';
    line.TermsOfPayment = `${Math.max(termsOfPaymentDays, 0)} Days`;
    line.DimensionModel = dimensions;
    line.BillingClassification = billingClassId;
    line.CreditNoteInvoiceRef = this.formatDocumentNumber(
      custLine.DOCUMENT || '',
    );

    if (billingCode) {
      line.BillingCode = billingCode.billingCode;
    } else {
      line.AddError(
        'BillingCode',
        `Could not found a billing code related to this charge type ${dimensions.chargeType}`,
      );
    }

    return line;
  }
}
