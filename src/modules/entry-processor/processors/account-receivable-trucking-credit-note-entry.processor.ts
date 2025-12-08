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
export class AccountReceivableTruckingCreditNoteEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableTruckingCreditNoteEntryProcessor.name,
  );
  readonly entryProcessorType =
    EntryProcessorTypes.AccountReceivableTruckingCreditNote;
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
    'TruckerType',
    'TruckNumber',
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
    // Load master data
    const accounts = await this.getAccountCustomerInvoiceMappings(
      ServiceTypes.Trucking,
    );

    const arData = data.map((raw) => {
      const model = new AccountReceivableFileModel();
      Object.assign(model, raw);
      return model;
    });

    // Group by VOUCHER and INVOICE
    const invoiceGroups = new Map<string, AccountReceivableFileModel[]>();
    for (const line of arData) {
      const key = `${line.VOUCHER || ''}_${line.INVOICE || ''}`;
      if (!invoiceGroups.has(key)) {
        invoiceGroups.set(key, []);
      }
      invoiceGroups.get(key)!.push(line);
    }

    const accLines: DynAccountReceivableLineDto[] = [];

    // Get billing codes for different classifications
    const invBillingCodes = await this.queryBus.execute(
      new GetBillingCodesQuery(company, 'INV-TR'),
    );
    const orBillingCodes = await this.queryBus.execute(
      new GetBillingCodesQuery(company, 'OR-TR'),
    );

    this.billingClassifications.set('inv-tr', invBillingCodes || []);
    this.billingClassifications.set('or-tr', orBillingCodes || []);

    for (const [_key, lines] of invoiceGroups.entries()) {
      // Get customer lines and ledger lines
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

      let invLineCount = 1;

      for (const custLine of custLines) {
        for (const ledgerLine of ledgerLines) {
          const accountDimensions = this.parseToDimensions(
            ledgerLine.ACCOUNTDISPLAYVALUE || '',
          );

          // Apply account mapping if needed
          if (
            accounts.some((a: any) =>
              a.customerAccount
                ?.toLowerCase()
                .includes(accountDimensions.customer?.toLowerCase() || ''),
            )
          ) {
            const mappingAccount = accounts.find((a: any) =>
              a.customerAccount
                ?.toLowerCase()
                .includes(accountDimensions.subCustomer?.toLowerCase() || ''),
            );
            if (mappingAccount) {
              accountDimensions.subCustomer = mappingAccount.invoiceAccount;
            }
          }

          ledgerLine.ACCOUNTDISPLAYVALUE =
            this.convertToStringDimensions(accountDimensions);

          // Determine billing classification from invoice/journal
          const billingClassification =
            this.getInvoiceBillingClassificationCode(custLine);

          // Get billing codes for this classification
          const classificationBillingCodes =
            this.billingClassifications.get(
              billingClassification?.toLowerCase() || '',
            ) || [];

          // Find matching billing code
          const billingCode = classificationBillingCodes.find((bc: IBillingCode) =>
            bc.billingCode
              ?.toLowerCase()
              .includes(accountDimensions.chargeType?.toLowerCase() || ''),
          );

          const arLine = this.prepareAccountReceivableLine(
            invLineCount,
            accountDimensions,
            custLine,
            ledgerLine,
            billingCode || null,
            billingClassification || '',
          );

          accLines.push(arLine);
          invLineCount++;
        }
      }
    }

    return accLines;
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
        ...billingCodes.map((bc: IBillingCode) => bc.billingCode).filter((bc) => bc),
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
      this.validateTruckerType(arLine, dimensionsMap.get('TruckerType') || []);
      this.validateTruckNumber(arLine, dimensionsMap.get('TruckNumber') || []);
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
    throw new Error('InsertIntoDynamicsAsync is not implemented for credit notes');
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
    if (journalName.includes('or-tr') || invoice.includes('or')) {
      return 'OR-TR';
    }
    if (journalName.includes('inv-tr') || invoice.includes('inv')) {
      return 'INV-TR';
    }

    // Default to INV-TR if cannot determine
    return 'INV-TR';
  }

  /**
   * Formats invoice number with CR or CN prefix based on billing classification
   * For trucking: "inv-tr" uses "CN", otherwise "CR"
   */
  private formatInvoiceNumber(invNumber: string, billingClass: string): string {
    const parts = invNumber.split('-');
    if (parts.length < 2) {
      return invNumber;
    }

    // For trucking, "inv-tr" uses "CN", otherwise "CR" (opposite of freight)
    const invoicePrefix = billingClass.toLowerCase() === 'inv-tr' ? 'CN' : 'CR';
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

    if (
      billingCode &&
      billingClassId &&
      this.billingClassifications.has(billingClassId.toLowerCase()) &&
      this.billingClassifications
        .get(billingClassId.toLowerCase())!
        .some((bc: IBillingCode) =>
          bc.billingCode
            ?.toLowerCase()
            .includes(dimensions.chargeType?.toLowerCase() || ''),
        )
    ) {
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

