import { Injectable, Logger } from '@nestjs/common';

import {
  YARD_BILLING_CLASSIFICATION_MAP,
  YARD_CHARGE_DESCRIPTION_GROUP_MAP,
  YARD_COA_MAIN_ACCOUNT_MAP,
  YARD_COST_CENTER_MAP,
  YARD_LOCATION_MAP,
  YARD_SHIPPING_LINE_GROUP_MAP,
} from '@/modules/accounts-receivable/constants/account-receivable-yard.constants';
import {
  AccountReceivableYardFileModel,
  DynAccountReceivableLineModel,
} from '@/modules/accounts-receivable/models';
import { validateTermsOfPayment } from '@/modules/accounts-receivable/processors/validate-terms-of-payment';
import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import {
  IBillingClassification,
  IBillingCode,
  IBillingCodeVersion,
  ICustomer,
  IFinancialDimensionValue,
  IMainAccount,
} from '@/modules/master-data/interfaces';

type YardLookupContext = {
  billingCodeVersions: IBillingCodeVersion[];
  billingCodeKeys: Set<string>;
  termsOfPaymentByBillingClass: Map<string, string>;
  customerByTaxNumber: Map<string, ICustomer>;
  chargeTypeByDescription: Map<string, IFinancialDimensionValue>;
  mainAccountById: Map<string, IMainAccount>;
};

type YardMapping = {
  sourceId: string;
  isCreditRow: boolean;
  freeTextNumber: string;
  issueDate: Date;
  dueDate?: Date;
  paymentDate?: Date;
  shippingLineGrouping: string;
  itemGrouping: string;
  mergedItem: string;
  costCenter: string;
  billingClassification: string;
  billingCode: string;
  customerAccount: string;
  chargeType: string;
  ledgerDimension: string;
  salesTaxGroup: string;
  salesTaxItemGroup: string;
  amount: number;
  currencyCode: string;
  defaultDimension: string;
  finTag: string;
  dimensions: EntryDimensionsModel;
};

@Injectable()
export class AccountReceivableYardEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableYardEntryProcessor.name,
  );

  readonly entryProcessorType = EntryProcessorTypes.AccountReceivableYard;

  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Activity: true,
    CostCenters: true,
    BusinessUnit: true,
    Location: true,
    Customer: true,
    SubCustomer: true,
    ChargeType: true,
    SalesMan: true,
    CoordinatorMan: true,
    FreightType: true,
    Direction: true,
  };

  constructor(
    baseDeps: EntryProcessorBaseDependencies,
    private readonly customerInvoiceService: CustomerInvoiceService,
  ) {
    super({ dependencies: baseDeps });
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    this.company = company;
    await this.warmupProcessorData({
      taxItemGroupCodes: true,
      paymentTerms: true,
      billingCodeVersions: true,
      billingCodes: true,
      billingClassifications: true,
      customers: true,
    });

    const yardRows = this.mapToYardRows(data);
    const lookupContext = this.buildLookupContext();
    const lineNumbersByInvoice = new Map<string, number>();
    const result: DynAccountReceivableLineModel[] = [];

    for (const yardRow of yardRows) {
      const line = this.prepareLine(yardRow, lookupContext);
      const lineNumber = this.nextLineNumber(
        line.FreeTextNumber,
        lineNumbersByInvoice,
      );
      line.LineNumber = lineNumber;
      result.push(line);
    }

    this.procLogger.debug(`Yard enriched rows: ${result.length}`);
    return result;
  }

  validateAsync(data: DynDataModel[]): DynDataModel[] {
    for (const arLine of data as DynAccountReceivableLineModel[]) {
      this.validateDimensionsForLine(arLine);
      this.validateSalesTaxItemGroupForLine(arLine);
      validateTermsOfPayment(arLine, this.getValidPaymentTermNames());
    }

    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    const invoiceGroups = new Map<string, DynAccountReceivableLineModel[]>();

    for (const line of data as DynAccountReceivableLineModel[]) {
      const invoiceNumber = line.FreeTextNumber || '';
      const invoiceLines = invoiceGroups.get(invoiceNumber) ?? [];
      invoiceLines.push(line);
      invoiceGroups.set(invoiceNumber, invoiceLines);
    }

    for (const lines of invoiceGroups.values()) {
      const firstLine = lines[0];
      if (!firstLine) continue;

      const createdInvoice =
        await this.customerInvoiceService.createInvoiceHeader(
          company,
          firstLine,
        );

      for (const line of lines) {
        await this.customerInvoiceService.createInvoiceLine(
          company,
          createdInvoice.InvoiceIdentifier || 0,
          line,
        );
      }
    }
  }

  private mapToYardRows(
    data: RawDataModel[],
  ): AccountReceivableYardFileModel[] {
    return data
      .map((raw, index) => {
        const model = new AccountReceivableYardFileModel();
        Object.assign(model, raw);
        model.UniqueId = model.UniqueId ?? index + 1;
        return model;
      })
      .filter((row) => this.shouldKeepRow(row));
  }

  private shouldKeepRow(row: AccountReceivableYardFileModel): boolean {
    if (this.normalizeStaticKey(row.source) === 'SOURCE') return false;
    if (!this.cleanSourceText(row['Document type'])) return false;
    return this.parseNumber(row.TOTAL) !== 0;
  }

  private buildLookupContext(): YardLookupContext {
    return {
      billingCodeVersions: this.getBillingCodeVersions(),
      billingCodeKeys: this.buildBillingCodeKeySet(this.getBillingCodes()),
      termsOfPaymentByBillingClass: this.buildTermsOfPaymentByBillingClass(
        this.getBillingClassifications(),
      ),
      customerByTaxNumber: this.buildCustomerByTaxNumber(this.getCustomers()),
      chargeTypeByDescription: this.buildChargeTypeByDescription(
        this.getFinancialDimensionValues('ChargeType'),
      ),
      mainAccountById: this.getMainAccountMap(),
    };
  }

  private prepareLine(
    row: AccountReceivableYardFileModel,
    context: YardLookupContext,
  ): DynAccountReceivableLineModel {
    const line = new DynAccountReceivableLineModel();
    const mapping = this.resolveMapping(row, context, line);

    line.SourceIds = [mapping.sourceId];
    line.UniqueId = Number(row.UniqueId) || undefined;
    line.CustomId = Number(row.UniqueId) || 0;
    line.FreeTextNumber = mapping.freeTextNumber;
    line.DocumentDate = mapping.issueDate;
    line.DueDate = mapping.dueDate;
    line.InvoiceDate = mapping.issueDate;
    line.CustomerAccount = mapping.customerAccount;
    line.CustomerReference = mapping.freeTextNumber;
    line.CustomerRequisition = '';
    line.InvoiceAccount = mapping.customerAccount;
    line.HeaderDefaultDimensionDisplayValue = mapping.defaultDimension;
    line.HeaderFinTagDisplayValue = mapping.finTag;
    line.DefaultDimensionDisplayValue = mapping.defaultDimension;
    line.LineFinTagDisplayValue = mapping.finTag;
    line.LedgerDimensionDisplayValue = mapping.ledgerDimension;
    line.Description = mapping.mergedItem;
    line.Quantity = 1;
    line.InvoiceTxt = mapping.mergedItem;
    line.UnitPrice = mapping.amount;
    line.AmountCur = mapping.amount;
    line.SalesTaxGroup = mapping.salesTaxGroup;
    line.SalesTaxItemGroup = mapping.salesTaxItemGroup;
    line.OverrideSalesTax = 'No';
    line.InclTax = 'Yes';
    line.BillingClassification = mapping.billingClassification;
    line.BillingCode = mapping.billingCode;
    line.CashDiscountCode = '';
    line.MethodOfPayment = '';
    line.TermsOfPayment =
      context.termsOfPaymentByBillingClass.get(
        mapping.billingClassification.toLowerCase(),
      ) ?? '';
    line.DirectDebitMandateId = '';
    line.PostingProfile = 'Cust-PP';
    line.EInvoiceAccountCode = '';
    line.EInvoiceIsLineSpecific = 'No';
    line.CurrencyCode = mapping.currencyCode;
    line.TransportationDocumentLineId = '';
    line.CreditNoteInvoiceRef = mapping.isCreditRow
      ? this.cleanSourceText(row['Invoice No.'])
      : '';
    line.DimensionModel = mapping.dimensions;

    // if (!line.TermsOfPayment) {
    //   line.AddError(
    //     'TermsOfPayment',
    //     `No terms of payment found for billing classification ${mapping.billingClassification}`,
    //   );
    // }

    return line;
  }

  private resolveMapping(
    row: AccountReceivableYardFileModel,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): YardMapping {
    const isCreditRow = this.isCreditRow(row);
    const issueDate = this.resolveRequiredDate(
      row.IssueDate,
      'IssueDate',
      line,
    );
    const dueDate = this.utilsService.toDate(row['Due Date']) ?? undefined;
    const paymentDate =
      this.utilsService.toDate(row['Payment Date']) ?? undefined;
    const shippingLineGrouping = this.resolveShippingLineGrouping(row, line);
    const itemGrouping = this.resolveItemGrouping(row, line);
    const mergedItem = this.resolveMergedItem(row, itemGrouping);
    const billingClassification = this.resolveBillingClassification(
      shippingLineGrouping,
      line,
    );
    const billingCode = this.resolveBillingCode(
      `${mergedItem} - ${shippingLineGrouping}`,
      billingClassification,
      issueDate,
      context,
      line,
    );
    const customerAccount = this.resolveCustomerAccount(row, context, line);
    const chargeType = this.resolveChargeType(mergedItem, context, line);
    const ledgerDimension = this.resolveLedgerDimension(
      mergedItem,
      isCreditRow,
      context,
      line,
    );
    const costCenter = this.resolveCostCenter(mergedItem, itemGrouping, line);
    const location = this.resolveLocation(row, line);
    const amount = this.parseNumber(row.TOTAL) * (isCreditRow ? -1 : 1);
    const dimensions = this.buildDimensions({
      ledgerDimension,
      costCenter,
      location,
      customerAccount,
      chargeType,
    });

    return {
      sourceId: String(row.UniqueId ?? ''),
      isCreditRow,
      freeTextNumber: this.resolveFreeTextNumber(row, isCreditRow, line),
      issueDate,
      dueDate,
      paymentDate,
      shippingLineGrouping,
      itemGrouping,
      mergedItem,
      costCenter,
      billingClassification,
      billingCode,
      customerAccount,
      chargeType,
      ledgerDimension,
      salesTaxGroup: this.parseNumber(row.VAT) === 0 ? 'Non-Taxabl' : 'Taxable',
      salesTaxItemGroup: this.parseNumber(row.VAT) === 0 ? '0' : 'VAT-14%',
      amount,
      currencyCode: this.cleanSourceText(row.Curr),
      defaultDimension: this.utilsService.toDimensionString(dimensions),
      finTag: this.buildFinTag(row, issueDate, paymentDate),
      dimensions,
    };
  }

  private resolveRequiredDate(
    value: unknown,
    fieldName: string,
    line: DynAccountReceivableLineModel,
  ): Date {
    const date = this.utilsService.toDate(value);
    if (date) return date;

    line.AddError(fieldName, `Invalid or missing ${fieldName}`);
    return new Date(0);
  }

  private resolveShippingLineGrouping(
    row: AccountReceivableYardFileModel,
    line: DynAccountReceivableLineModel,
  ): string {
    const key = this.normalizeStaticKey(row['Shipping Line']);
    const grouping = YARD_SHIPPING_LINE_GROUP_MAP[key];

    if (!grouping) {
      line.AddError(
        'ShippingLine',
        `No Yard shipping line mapping found for ${this.cleanSourceText(row['Shipping Line'])}`,
      );
    }

    return grouping ?? '';
  }

  private resolveItemGrouping(
    row: AccountReceivableYardFileModel,
    line: DynAccountReceivableLineModel,
  ): string {
    const key = this.normalizeStaticKey(row['Description of charges']);
    const itemGrouping = YARD_CHARGE_DESCRIPTION_GROUP_MAP[key];

    if (!itemGrouping) {
      line.AddError(
        'DescriptionOfCharges',
        `No Yard charge mapping found for ${this.cleanSourceText(row['Description of charges'])}`,
      );
    }

    return itemGrouping ?? '';
  }

  private resolveMergedItem(
    row: AccountReceivableYardFileModel,
    itemGrouping: string,
  ): string {
    if (itemGrouping !== 'Custom Shifting') {
      return itemGrouping;
    }

    const movementType = this.normalizeStaticKey(row.MovementType);
    if (movementType === 'IN') return 'Custom Shifting Lift off';
    if (movementType === 'OUT') return 'Custom Shifting Lift on';
    return itemGrouping;
  }

  private resolveBillingClassification(
    shippingLineGrouping: string,
    line: DynAccountReceivableLineModel,
  ): string {
    const billingClassification =
      YARD_BILLING_CLASSIFICATION_MAP[shippingLineGrouping];

    if (!billingClassification) {
      line.AddError(
        'BillingClassification',
        `No billing classification mapping found for ${shippingLineGrouping}`,
      );
    }

    return billingClassification ?? '';
  }

  private resolveBillingCode(
    chargeCodeMerge: string,
    billingClassification: string,
    issueDate: Date,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const version = context.billingCodeVersions.find((candidate) => {
      return (
        this.trimOnly(candidate.billingCodeDescription) === chargeCodeMerge
      );
    });

    if (!version?.billingCode) {
      line.AddError(
        'BillingCode',
        `No active BillingCodeVersion found for ${chargeCodeMerge} on ${this.formatDateForMessage(issueDate)}`,
      );
      return '';
    }

    const key = this.billingCodeKey(
      billingClassification === 'Yard-Turkon Egypt'
        ? 'Yard-Turkon Egy'
        : billingClassification,
      version.billingCode,
    );
    if (!context.billingCodeKeys.has(key)) {
      line.AddError(
        'BillingCode',
        `Billing code ${version.billingCode} is not valid for ${billingClassification}`,
      );
    }

    return version.billingCode;
  }

  private resolveCustomerAccount(
    row: AccountReceivableYardFileModel,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const taxNumber = this.normalizeTaxNumber(row['Tax No']);
    const customer = context.customerByTaxNumber.get(taxNumber);

    if (!taxNumber || !customer?.customerAccount) {
      line.AddError(
        'CustomerAccount',
        `No customer found using normalized TaxExemptNumber "${taxNumber}" from source Tax No "${this.cleanSourceText(row['Tax No'])}".`,
      );
      if (taxNumber) {
        line.AddMissingMasterData({
          type: 'customer',
          missingField: 'TaxExemptNumber',
          missingValue: taxNumber,
          formDefaults: {
            TaxExemptNumber: taxNumber,
          },
        });
      }
    }

    return customer?.customerAccount ?? '';
  }

  private resolveChargeType(
    mergedItem: string,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const chargeType = context.chargeTypeByDescription.get(
      this.trimOnly(mergedItem) === 'Kashf Estkhlas'
        ? 'Kashf Estkhla'
        : this.trimOnly(mergedItem),
    );

    if (!chargeType?.value) {
      line.AddError(
        'ChargeType',
        `No exact-case ChargeType dimension description found for ${mergedItem}`,
      );
      return '';
    }

    if (chargeType.isSuspended === 'Yes') {
      line.AddError(
        'ChargeType',
        `ChargeType ${chargeType.value} is suspended`,
      );
    }
    if (chargeType.isBlockedForManualEntry === 'Yes') {
      line.AddError(
        'ChargeType',
        `ChargeType ${chargeType.value} is blocked for manual entry`,
      );
    }
    if (chargeType.isTotal === 'Yes') {
      line.AddError('ChargeType', `ChargeType ${chargeType.value} is total`);
    }

    return chargeType.value;
  }

  private resolveLedgerDimension(
    mergedItem: string,
    isCreditRow: boolean,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const accountId = isCreditRow
      ? '417901'
      : YARD_COA_MAIN_ACCOUNT_MAP[mergedItem];

    if (!accountId) {
      line.AddError(
        'LedgerDimensionDisplayValue',
        `No Yard COA account mapping found for ${mergedItem}`,
      );
      return '';
    }

    this.validateMainAccount(accountId, isCreditRow, context, line);
    return accountId;
  }

  private resolveCostCenter(
    mergedItem: string,
    itemGrouping: string,
    line: DynAccountReceivableLineModel,
  ): string {
    const costCenter =
      YARD_COST_CENTER_MAP[mergedItem] ?? YARD_COST_CENTER_MAP[itemGrouping];

    if (!costCenter) {
      line.AddError(
        'CostCenter',
        `No Yard cost center mapping found for ${mergedItem}`,
      );
    }

    return costCenter ?? '';
  }

  private resolveLocation(
    row: AccountReceivableYardFileModel,
    line: DynAccountReceivableLineModel,
  ): string {
    const source = this.normalizeStaticKey(row.source);
    const location = YARD_LOCATION_MAP[source];

    if (!location) {
      line.AddError(
        'Location',
        `No Yard location mapping found for ${this.cleanSourceText(row.source)}`,
      );
    }

    return location ?? '';
  }

  private validateMainAccount(
    accountId: string,
    isCreditRow: boolean,
    context: YardLookupContext,
    line: DynAccountReceivableLineModel,
  ): void {
    const account = context.mainAccountById.get(accountId);

    if (!account) {
      line.AddError('MainAccount', `Main account ${accountId} does not exist`);
      return;
    }
    if (account.isSuspended === 'Yes') {
      line.AddError('MainAccount', `Main account ${accountId} is suspended`);
    }
    if (account.doNotAllowManualEntry === 'Yes') {
      line.AddError(
        'MainAccount',
        `Main account ${accountId} does not allow manual entry`,
      );
    }
    if (!isCreditRow && account.mainAccountType !== 'Revenue') {
      line.AddError(
        'MainAccount',
        `Main account ${accountId} type is ${account.mainAccountType || 'missing'}, expected Revenue`,
      );
    }
  }

  private resolveFreeTextNumber(
    row: AccountReceivableYardFileModel,
    isCreditRow: boolean,
    line: DynAccountReceivableLineModel,
  ): string {
    const sourceNumber = this.cleanSourceText(
      isCreditRow ? row['Crdt No.'] : row['Invoice No.'],
    );
    const suffix = isCreditRow ? 'YD-CN' : 'YD';
    const digits = this.extractFreeTextSequence(sourceNumber);

    if (!digits) {
      line.AddError(
        'FreeTextNumber',
        `No ${isCreditRow ? 'credit' : 'invoice'} number found`,
      );
      return `/${suffix}`;
    }

    return `${digits.padStart(9, '0')}/${suffix}`;
  }

  private extractFreeTextSequence(sourceNumber: string): string {
    const token = sourceNumber.split('/')?.shift()?.trim() ?? '';
    const lastDash = token.lastIndexOf('-');
    const sequenceSource =
      lastDash >= 0 ? token.slice(lastDash + 1).trim() : token;
    return sequenceSource.replace(/\D/g, '').slice(-9);
  }

  private buildDimensions(args: {
    ledgerDimension: string;
    costCenter: string;
    location: string;
    customerAccount: string;
    chargeType: string;
  }): EntryDimensionsModel {
    return {
      mainAccount: args.ledgerDimension,
      costCenter: args.costCenter,
      activityName: '024',
      businessUnit: '002',
      location: args.location,
      customer: args.customerAccount,
      subCustomer: args.customerAccount,
      chargeType: args.chargeType,
      salesMan: '3171',
      coordinatorMan: '3171',
      freightType: 'Payable',
      direction: 'Domestic',
    };
  }

  private buildFinTag(
    row: AccountReceivableYardFileModel,
    issueDate: Date,
    paymentDate?: Date,
  ): string {
    const tags = [
      this.cleanSourceText(row['Booking No.']),
      '',
      this.cleanSourceText(row['Shipping Line']),
      '',
      '',
      this.cleanSourceText(row['Container No']),
      this.cleanSourceText(row['Size/Type']),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      this.formatDateForMessage(issueDate),
      paymentDate ? this.formatDateForMessage(paymentDate) : '',
    ];

    return tags.join('|');
  }

  private buildBillingCodeKeySet(codes: IBillingCode[]): Set<string> {
    return new Set(
      codes
        .filter((code) => code.billingClassification && code.billingCode)
        .map((code) =>
          this.billingCodeKey(code.billingClassification, code.billingCode),
        ),
    );
  }

  private buildTermsOfPaymentByBillingClass(
    billingClasses: IBillingClassification[],
  ): Map<string, string> {
    const termsByClass = new Map<string, string>();

    for (const item of billingClasses) {
      if (!item.billingClassification || !item.termsOfPayment) continue;
      termsByClass.set(
        item.billingClassification.toLowerCase(),
        item.termsOfPayment,
      );
    }

    return termsByClass;
  }

  private buildCustomerByTaxNumber(
    customers: ICustomer[],
  ): Map<string, ICustomer> {
    const customerByTaxNumber = new Map<string, ICustomer>();

    for (const customer of customers) {
      const taxNumber = this.normalizeTaxNumber(customer.taxExemptNumber);
      if (!taxNumber) continue;
      customerByTaxNumber.set(taxNumber, customer);
    }

    return customerByTaxNumber;
  }

  private buildChargeTypeByDescription(
    chargeTypes: IFinancialDimensionValue[],
  ): Map<string, IFinancialDimensionValue> {
    const chargeTypeByDescription = new Map<string, IFinancialDimensionValue>();

    for (const chargeType of chargeTypes) {
      const description = this.trimOnly(chargeType.description);
      if (!description) continue;
      chargeTypeByDescription.set(description, chargeType);
    }

    return chargeTypeByDescription;
  }

  private nextLineNumber(
    freeTextNumber: string,
    counters: Map<string, number>,
  ): number {
    const next = (counters.get(freeTextNumber) ?? 0) + 1;
    counters.set(freeTextNumber, next);
    return next;
  }

  private isCreditRow(row: AccountReceivableYardFileModel): boolean {
    const documentType = this.normalizeStaticKey(row['Document type']);
    if (documentType.includes('CREDIT') || documentType.includes('CRDT')) {
      return true;
    }
    if (documentType.includes('INVOICE')) {
      return false;
    }

    return this.hasMeaningfulSourceValue(row['Crdt No.']);
  }

  private isDateWithinRange(
    issueDate: Date,
    validFrom: Date,
    validTo: Date,
  ): boolean {
    const issueMs = issueDate.getTime();
    return (
      issueMs >= new Date(validFrom).getTime() &&
      issueMs <= new Date(validTo).getTime()
    );
  }

  private billingCodeKey(
    billingClassification: string,
    billingCode: string,
  ): string {
    return `${billingClassification.trim().toLowerCase()}|${billingCode.trim().toLowerCase()}`;
  }

  private normalizeStaticKey(value: unknown): string {
    return this.cleanSourceText(value).replace(/\s+/g, ' ').toUpperCase();
  }

  private cleanSourceText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const result = (value as { result?: unknown }).result;
      return this.cleanSourceText(result);
    }
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return this.removeHiddenCharacters(String(value)).trim();
  }

  private trimOnly(value: unknown): string {
    return this.cleanSourceText(value);
  }

  private normalizeTaxNumber(value: unknown): string {
    return this.cleanSourceText(value).replace(/[-/]/g, '');
  }

  private parseNumber(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'object') {
      return this.parseNumber((value as { result?: unknown }).result);
    }
    if (typeof value !== 'string') return 0;
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private hasMeaningfulSourceValue(value: unknown): boolean {
    const text = this.cleanSourceText(value);
    if (!text) return false;

    const normalized = text.toUpperCase();
    return !['0', 'NA', 'N/A', '-', '--'].includes(normalized);
  }

  private removeHiddenCharacters(value: string): string {
    return [...value]
      .filter((char) => {
        const code = char.charCodeAt(0);
        const isControl = code <= 31 || (code >= 127 && code <= 159);
        const isHiddenUnicode =
          code === 0x200b ||
          code === 0x200c ||
          code === 0x200d ||
          code === 0xfeff;
        return !isControl && !isHiddenUnicode;
      })
      .join('');
  }

  private formatDateForMessage(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
