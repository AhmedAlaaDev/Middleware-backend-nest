import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';

@Injectable()
export class AccountReceivableFreightCreditNoteEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableFreightCreditNoteEntryProcessor.name,
  );
  readonly entryProcessorType =
    EntryProcessorTypes.AccountReceivableFreightCreditNote;
  readonly requiredDimensions = [
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

  constructor(
    customerInvoiceService: CustomerInvoiceService,
    queryBus: QueryBus,
    db: DBService,
  ) {
    super(customerInvoiceService, queryBus, db);
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
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
        const dims = this.parseToDimensions(
          ledgerLine.ACCOUNTDISPLAYVALUE || '',
        );
        this.applySubCustomerMapping(dims, accounts);
        ledgerLine.ACCOUNTDISPLAYVALUE = this.convertToStringDimensions(dims);
        const classification =
          this.getInvoiceBillingClassificationCode(custLine);
        const codes =
          this.billingClassifications.get(
            classification?.toLowerCase() || '',
          ) || [];
        const billingCode = this.findBillingCodeFromClassification(
          codes,
          dims.chargeType,
        );
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

  private applySubCustomerMapping(dims: any, accounts: any[]): void {
    if (
      accounts.some((a: any) =>
        a.customerAccount
          ?.toLowerCase()
          .includes(dims.customer?.toLowerCase() || ''),
      )
    ) {
      const mapping = accounts.find((a: any) =>
        a.customerAccount
          ?.toLowerCase()
          .includes(dims.subCustomer?.toLowerCase() || ''),
      );
      if (mapping) dims.subCustomer = mapping.invoiceAccount;
    }
  }

  private findBillingCodeFromClassification(
    codes: IBillingCode[],
    chargeType?: string,
  ): IBillingCode | undefined {
    if (!chargeType) return undefined;
    return codes.find((bc) =>
      bc.billingCode?.toLowerCase().includes(chargeType.toLowerCase()),
    );
  }

  async validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]> {
    const arData = data as DynAccountReceivableLineDto[];
    // Load dimensions and accounts
    const accounts = await this.getAllMainAccounts();

    const dimensionsMap = new Map<string, IFinancialDimensionValue[]>();
    for (const dimensionKey of this.requiredDimensions) {
      const dimensionValues =
        await this.getFinancialDimensionValues(dimensionKey);
      dimensionsMap.set(dimensionKey, dimensionValues || []);
    }

    // Get charge type dimensions from billing codes
    const chargeTypeDims: string[] = [];
    for (const billingCodes of this.billingClassifications.values()) {
      chargeTypeDims.push(
        ...billingCodes
          .map((bc: IBillingCode) => bc.billingCode)
          .filter((bc) => bc),
      );
    }
    const uniqueChargeTypeDims = Array.from(new Set(chargeTypeDims));

    // Validate each line
    for (const arLine of arData) {
      this.validateMainAccount(
        arLine,
        accounts.map((a: any) => ({ accountNumber: a.accountNumber })),
      );
      this.validateActivityName(arLine, dimensionsMap.get('Activity') || []);
      this.validateCostCenter(arLine, dimensionsMap.get('CostCenters') || []);
      this.validateBusinessUnit(
        arLine,
        dimensionsMap.get('BusinessUnit') || [],
      );
      this.validateLocation(arLine, dimensionsMap.get('Location') || []);
      this.validateCustomerDimension(
        arLine,
        dimensionsMap.get('Customer') || [],
      );
      this.validateSubCustomerDimension(
        arLine,
        dimensionsMap.get('SubCustomer') || [],
      );
      this.validateChargeTypeDimension(arLine, uniqueChargeTypeDims);
      this.validateSalesMan(arLine, dimensionsMap.get('SalesMan') || []);
      this.validateFreightType(arLine, dimensionsMap.get('FreightType') || []);
      this.validateDirection(arLine, dimensionsMap.get('Direction') || []);
      this.validateCoordinatorMan(
        arLine,
        dimensionsMap.get('CoordinatorMan') || [],
      );
    }
    this.procLogger.debug('data Validated');
    return data;
  }

  async insertIntoDynamicsAsync(
    _data: DynDataModel[],
    _company: string,
  ): Promise<void> {
    // Not implemented for credit notes
    throw new Error(
      'InsertIntoDynamicsAsync is not implemented for credit notes',
    );
  }

  /**
   * Determines billing classification code from invoice/journal
   * Based on the journal name or invoice pattern
   */
  private getInvoiceBillingClassificationCode(
    custLine: AccountReceivableFileModel,
  ): string {
    const journalName = custLine.JOURNALNAME?.toLowerCase() || '';
    const invoice = custLine.INVOICE?.toLowerCase() || '';

    // Check journal name first
    if (journalName.includes('or-fw') || invoice.includes('or')) {
      return 'OR-FW';
    }
    if (journalName.includes('of-fw') || invoice.includes('of')) {
      return 'OF-FW';
    }
    if (journalName.includes('inv-fw') || invoice.includes('inv')) {
      return 'INV-FW';
    }

    // Default to INV-FW if cannot determine
    return 'INV-FW';
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
   * Formats document number to 8 digits
   */
  private formatDocumentNumber(docNumber: string): string {
    if (!docNumber || !docNumber.trim()) {
      return '00000000';
    }

    const parts = docNumber.split('/');
    const number = parseInt(parts[0], 10);

    if (!isNaN(number)) {
      return number.toString().padStart(8, '0');
    }

    return '00000000';
  }

  /**
   * Prepares account receivable line for credit note
   * Uses negative amounts (credit note logic)
   */
  protected prepareAccountReceivableLine(
    lineNumber: number,
    dimensions: AccountDimensionsModel,
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    billingCode: IBillingCode | null,
    billingClassId: string,
  ): DynAccountReceivableLineDto {
    const transDate = this.coerceToDate(custLine.TRANSDATE) as Date;
    const dueDate = this.coerceToDate(custLine.DUEDATE);
    const cashDiscountDate = this.coerceToDate(custLine.CASHDISCOUNTDATE);

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
    line.FreeTextNumber = this.formatInvoiceNumber(
      custLine.INVOICE || '',
      billingClassId,
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
    line.CustomerReference = this.formatInvoiceNumber(
      custLine.INVOICE || '',
      billingClassId,
    );
    line.EInvoiceIsLineSpecific = 'No';
    line.InclTax = 'Yes';
    line.InvoiceAccount = dimensions.customer || '';
    line.InvoiceDate = transDate || undefined;
    line.LedgerDimensionDisplayValue = dimensions.mainAccount || '';
    line.OverrideSalesTax = 'No';
    line.PostingProfile = 'Cust-PP';
    line.TermsOfPayment = transDate
      ? transDate.toISOString().split('T')[0]
      : '';
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
