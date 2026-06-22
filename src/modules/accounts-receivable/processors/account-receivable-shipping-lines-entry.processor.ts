import { Injectable, Logger } from '@nestjs/common';

import {
  SHIPPING_LINES_CHARGE_CODE_MAPPINGS,
  SHIPPING_LINES_COA_MAPPINGS,
  SHIPPING_LINES_SUPPORTED_CURRENCIES,
  ShippingLinesCoaMapping,
} from '@/modules/accounts-receivable/constants/account-receivable-shipping-lines.constants';
import {
  AccountReceivableShippingLinesFileModel,
  DynAccountReceivableLineModel,
} from '@/modules/accounts-receivable/models';
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
  ICustomer,
  IMainAccount,
} from '@/modules/master-data/interfaces';

type ShippingLookupContext = {
  coaByKey: Map<string, ShippingLinesCoaMapping>;
  chargeCodeByDescription: Map<string, string>;
  billingCodeKeys: Set<string>;
  termsByClassification: Map<string, string>;
  customersByTaxNumber: Map<string, ICustomer[]>;
  mainAccountById: Map<string, IMainAccount>;
};

@Injectable()
export class AccountReceivableShippingLinesEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableShippingLinesEntryProcessor.name,
  );

  readonly entryProcessorType =
    EntryProcessorTypes.AccountReceivableShippingLines;

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
    rawRows: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    this.company = company;
    await this.warmupProcessorData({
      exchangeRates: false,
      taxItemGroupCodes: true,
      billingCodes: true,
      billingClassifications: true,
      customers: true,
    });

    const context = this.buildLookupContext();
    const lineNumbersByInvoice = new Map<string, number>();
    const enhancedLines: DynAccountReceivableLineModel[] = [];

    for (const row of this.mapRows(rawRows)) {
      const line = this.prepareLine(row, context);
      line.LineNumber = this.nextLineNumber(
        line.FreeTextNumber,
        lineNumbersByInvoice,
      );
      enhancedLines.push(line);
    }

    this.procLogger.debug(
      `Shipping Lines enriched rows: ${enhancedLines.length}`,
    );
    return enhancedLines;
  }

  validateAsync(enhancedRows: DynDataModel[]): DynDataModel[] {
    const lines = enhancedRows as DynAccountReceivableLineModel[];
    for (const line of lines) {
      this.validateDimensionsForLine(line);
      if (line.SalesTaxItemGroup?.trim()) {
        this.validateSalesTaxItemGroupForLine(line);
      }
    }
    this.validateHeaderConsistency(lines);
    return lines;
  }

  async insertIntoDynamicsAsync(
    enhancedRows: DynDataModel[],
    company: string,
  ): Promise<void> {
    const groups = new Map<string, DynAccountReceivableLineModel[]>();
    for (const line of enhancedRows as DynAccountReceivableLineModel[]) {
      const group = groups.get(line.FreeTextNumber) ?? [];
      group.push(line);
      groups.set(line.FreeTextNumber, group);
    }

    for (const lines of groups.values()) {
      const firstLine = lines[0];
      if (!firstLine) continue;
      const invoice = await this.customerInvoiceService.createInvoiceHeader(
        company,
        firstLine,
      );
      for (const line of lines) {
        await this.customerInvoiceService.createInvoiceLine(
          company,
          invoice.InvoiceIdentifier || 0,
          line,
        );
      }
    }
  }

  private mapRows(
    rawRows: RawDataModel[],
  ): AccountReceivableShippingLinesFileModel[] {
    return rawRows.map((raw, index) => {
      const row = new AccountReceivableShippingLinesFileModel();
      Object.assign(row, raw);
      row.UniqueId = row.UniqueId ?? index + 1;
      return row;
    });
  }

  private buildLookupContext(): ShippingLookupContext {
    const coaByKey = new Map<string, ShippingLinesCoaMapping>();
    for (const mapping of SHIPPING_LINES_COA_MAPPINGS) {
      const key = this.coaKey(
        mapping.code,
        mapping.type,
        mapping.direction,
        mapping.lineName,
      );
      if (coaByKey.has(key)) {
        throw new Error(`Duplicate Shipping Lines COA mapping: ${key}`);
      }
      coaByKey.set(key, mapping);
    }

    return {
      coaByKey,
      chargeCodeByDescription: new Map(
        Object.entries(SHIPPING_LINES_CHARGE_CODE_MAPPINGS),
      ),
      billingCodeKeys: this.buildBillingCodeKeys(this.getBillingCodes()),
      termsByClassification: this.buildTermsByClassification(
        this.getBillingClassifications(),
      ),
      customersByTaxNumber: this.buildCustomersByTaxNumber(this.getCustomers()),
      mainAccountById: this.getMainAccountMap(),
    };
  }

  private prepareLine(
    row: AccountReceivableShippingLinesFileModel,
    context: ShippingLookupContext,
  ): DynAccountReceivableLineModel {
    const line = new DynAccountReceivableLineModel();
    const rowId = this.rowId(row);
    const sourceType = this.normalizeStaticKey(row['Invoice / CN']);
    const amount = this.parseRequiredNumber(
      row.Total_Cur,
      'Total_Cur',
      rowId,
      line,
    );
    const vat = this.parseRequiredNumber(row.VAT_Cur, 'VAT_Cur', rowId, line);
    const docType: 'INV' | 'CN' = amount < 0 ? 'CN' : 'INV';
    this.validateSourceDocumentType(sourceType, docType, rowId, line);

    const invoiceDate = this.resolveDate(
      row['Invoice Date'],
      'Invoice Date',
      rowId,
      line,
    );
    const vesselDate = this.resolveDate(
      row['Vsl.Date'],
      'Vsl.Date',
      rowId,
      line,
    );
    const coa = this.resolveCoa(row, rowId, context, line);
    const baseBillingCode = this.resolveBaseBillingCode(
      row,
      rowId,
      context,
      line,
    );
    const billingClassification = coa?.billingClassification ?? '';
    const billingCode = this.resolveBillingCode(
      baseBillingCode,
      billingClassification,
      rowId,
      context,
      line,
    );
    const customerAccount = this.resolveCustomerAccount(
      row,
      rowId,
      context,
      line,
    );
    const currency = this.resolveCurrency(row, rowId, line);
    const ledgerDimension =
      sourceType === 'C' && billingClassification === 'Inv-SH'
        ? '417901'
        : (coa?.mainAccount ?? '');
    this.validateMainAccount(ledgerDimension, rowId, context, line);

    const dimensions = this.buildDimensions(
      ledgerDimension,
      coa?.costCenter ?? '',
      customerAccount,
      baseBillingCode,
      row,
    );
    const defaultDimension = this.buildDefaultDimension(dimensions);
    const finTag = this.buildFinTag(row, vesselDate, invoiceDate);
    const freeTextNumber = this.resolveFreeTextNumber(
      row,
      sourceType,
      billingClassification,
      rowId,
      line,
    );
    const termsOfPayment =
      context.termsByClassification.get(billingClassification.toLowerCase()) ??
      '';
    if (!termsOfPayment) {
      line.AddError(
        'TermsOfPayment',
        `Row ${rowId}: terms of payment is missing for billing classification "${billingClassification}". Sync Billing Data.`,
      );
    }

    line.SourceIds = [
      this.cleanSourceText(row.Ser) || String(row.UniqueId ?? ''),
    ];
    line.UniqueId = row.UniqueId;
    line.CustomId = Number(row.UniqueId) || 0;
    line.FreeTextNumber = freeTextNumber;
    line.DocumentDate = invoiceDate;
    line.DueDate = invoiceDate;
    line.InvoiceDate = invoiceDate;
    line.CustomerAccount = customerAccount;
    line.CustomerReference = freeTextNumber;
    line.CustomerRequisition = '';
    line.InvoiceAccount = customerAccount;
    line.HeaderDefaultDimensionDisplayValue = defaultDimension;
    line.HeaderFinTagDisplayValue = finTag;
    line.DefaultDimensionDisplayValue = defaultDimension;
    line.LineFinTagDisplayValue = finTag;
    line.LedgerDimensionDisplayValue = ledgerDimension;
    line.Description = this.cleanSourceText(row['Invoice Items']);
    line.Quantity = 1;
    line.InvoiceTxt = line.Description;
    line.UnitPrice = amount;
    line.AmountCur = amount;
    line.SalesTaxGroup = vat === 0 ? 'Non-Taxable' : 'Taxable';
    line.SalesTaxItemGroup = vat === 0 ? '' : 'VAT-14%';
    line.OverrideSalesTax = 'No';
    line.InclTax = 'Yes';
    line.BillingClassification = billingClassification;
    line.BillingCode = billingCode;
    line.CashDiscountCode = '0';
    line.MethodOfPayment = '';
    line.TermsOfPayment = termsOfPayment;
    line.DirectDebitMandateId = '';
    line.PostingProfile = 'Cust-PP';
    line.EInvoiceAccountCode = '';
    line.EInvoiceIsLineSpecific = 'No';
    line.CurrencyCode = currency;
    line.TransportationDocumentLineId = '';
    line.CreditNoteInvoiceRef =
      docType === 'CN' ? this.cleanSourceText(row['Invoice no']) : '';
    line.DocType = docType;
    line.DimensionModel = dimensions;
    return line;
  }

  private resolveCoa(
    row: AccountReceivableShippingLinesFileModel,
    rowId: string,
    context: ShippingLookupContext,
    line: DynAccountReceivableLineModel,
  ): ShippingLinesCoaMapping | undefined {
    const key = this.coaKey(
      row.Code,
      row.Type,
      row['IMP / EXP'],
      row['LINE NAME'],
    );
    const mapping = context.coaByKey.get(key);
    if (!mapping) {
      line.AddError('COA', `Row ${rowId}: no COA mapping for "${key}".`);
    }
    return mapping;
  }

  private resolveBaseBillingCode(
    row: AccountReceivableShippingLinesFileModel,
    rowId: string,
    context: ShippingLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const description = this.cleanSourceText(row['Invoice Items']);
    const code = context.chargeCodeByDescription.get(description);
    if (!code) {
      line.AddError(
        'BillingCode',
        `Row ${rowId}: no exact charge-code mapping for Invoice Items "${description}".`,
      );
    }
    return code ?? '';
  }

  private resolveBillingCode(
    baseCode: string,
    classification: string,
    rowId: string,
    context: ShippingLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const finalCode = classification === 'OF-SH' ? `${baseCode}-OF` : baseCode;
    if (
      finalCode &&
      !context.billingCodeKeys.has(
        this.billingCodeKey(classification, finalCode),
      )
    ) {
      line.AddError(
        'BillingCode',
        `Row ${rowId}: billing code "${finalCode}" is not valid for classification "${classification}" in company "${this.company}".`,
      );
    }
    return finalCode;
  }

  private resolveCustomerAccount(
    row: AccountReceivableShippingLinesFileModel,
    rowId: string,
    context: ShippingLookupContext,
    line: DynAccountReceivableLineModel,
  ): string {
    const taxNumber = this.normalizeTaxNumber(row['TaxNo.']);
    if (!taxNumber) {
      line.AddError(
        'CustomerAccount',
        `Row ${rowId}: missing TaxNo. value required for customer resolution.`,
      );
      return '';
    }

    const matches = context.customersByTaxNumber.get(taxNumber) ?? [];
    const selected = matches[0];
    if (!selected?.customerAccount) {
      line.AddError(
        'CustomerAccount',
        `Row ${rowId}: no synced customer matches TaxExemptNumber "${taxNumber}" in company "${this.company}".`,
      );
      line.AddMissingMasterData({
        type: 'customer',
        missingField: 'CustomerAccount',
        missingValue: taxNumber,
        formDefaults: { TaxExemptNumber: taxNumber },
      });
      return '';
    }

    const accounts = [
      ...new Set(matches.map((customer) => customer.customerAccount)),
    ];
    if (matches.length > 1) {
      line.AddError(
        'CustomerAccount',
        `Row ${rowId}: Tax number "${taxNumber}" matched multiple customers: ${accounts.join(', ')}. The first customer "${selected.customerAccount}" was used.`,
      );
    }
    return selected.customerAccount;
  }

  private resolveCurrency(
    row: AccountReceivableShippingLinesFileModel,
    rowId: string,
    line: DynAccountReceivableLineModel,
  ): string {
    const source = this.cleanSourceText(row.Currency);
    const currency = source.toUpperCase();
    if (!SHIPPING_LINES_SUPPORTED_CURRENCIES.has(currency)) {
      line.AddError(
        'CurrencyCode',
        `Row ${rowId}: currency "${source}" is not supported or not valid.`,
      );
    }
    return currency;
  }

  private validateMainAccount(
    accountId: string,
    rowId: string,
    context: ShippingLookupContext,
    line: DynAccountReceivableLineModel,
  ): void {
    const account = context.mainAccountById.get(accountId);
    if (!account) {
      line.AddError(
        'MainAccount',
        `Row ${rowId}: main account "${accountId}" does not exist.`,
      );
      return;
    }
    if (account.isSuspended === 'Yes') {
      line.AddError(
        'MainAccount',
        `Row ${rowId}: main account "${accountId}" is suspended.`,
      );
    }
    if (account.doNotAllowManualEntry === 'Yes') {
      line.AddError(
        'MainAccount',
        `Row ${rowId}: main account "${accountId}" does not allow manual entry.`,
      );
    }
  }

  private resolveFreeTextNumber(
    row: AccountReceivableShippingLinesFileModel,
    sourceType: string,
    billingClassification: string,
    rowId: string,
    line: DynAccountReceivableLineModel,
  ): string {
    const isCredit = sourceType === 'C';
    const rawBase = this.cleanSourceText(
      isCredit ? row['Credit Note No.'] : row['Invoice no'],
    );
    const base = isCredit ? rawBase.slice(-5) : rawBase;
    if (!base) {
      line.AddError(
        'FreeTextNumber',
        `Row ${rowId}: missing ${isCredit ? 'Credit Note No.' : 'Invoice no'} required for FreeTextNumber.`,
      );
    }
    if (base.length > 9) {
      line.AddError(
        'FreeTextNumber',
        `Row ${rowId}: FreeTextNumber base "${base}" exceeds 9 characters.`,
      );
    }
    const suffix = isCredit ? 'CN-SH' : billingClassification;
    return `${base.padStart(9, '0')}/${suffix}`;
  }

  private buildDimensions(
    mainAccount: string,
    costCenter: string,
    customer: string,
    chargeType: string,
    row: AccountReceivableShippingLinesFileModel,
  ): EntryDimensionsModel {
    return {
      mainAccount,
      costCenter,
      activityName: '031',
      businessUnit: '003',
      location: '001',
      customer,
      subCustomer: customer,
      chargeType,
      salesMan: 'General',
      coordinatorMan: 'General',
      freightType: 'Prepaid',
      direction:
        this.normalizeStaticKey(row['IMP / EXP']) === 'IMP'
          ? 'Import'
          : 'Export',
    };
  }

  private buildDefaultDimension(dimensions: EntryDimensionsModel): string {
    return [
      '',
      dimensions.costCenter,
      dimensions.activityName,
      dimensions.businessUnit,
      dimensions.location,
      dimensions.customer,
      dimensions.subCustomer,
      '',
      '',
      dimensions.chargeType,
      dimensions.salesMan,
      dimensions.coordinatorMan,
      dimensions.freightType,
      '',
      '',
      dimensions.direction,
      '',
      '',
      '',
      '',
    ]
      .map((value) => value ?? '')
      .join('|');
  }

  private buildFinTag(
    row: AccountReceivableShippingLinesFileModel,
    vesselDate: Date,
    invoiceDate: Date,
  ): string {
    const formattedVesselDate = this.formatDate(vesselDate);
    const formattedInvoiceDate = this.formatDate(invoiceDate);
    const billOfLading = this.cleanSourceText(row['B/L']);
    const weight = this.cleanSourceText(row['GW / LM']);
    return [
      this.cleanSourceText(row['Ref NO.']),
      '',
      this.cleanSourceText(row['LINE NAME']),
      '',
      billOfLading,
      '',
      '',
      billOfLading,
      this.cleanSourceText(row.Voyage),
      this.cleanSourceText(row.Vessel),
      '',
      '',
      formattedVesselDate,
      formattedVesselDate,
      formattedInvoiceDate,
      weight,
      weight,
      formattedVesselDate,
      formattedInvoiceDate,
    ].join('|');
  }

  private validateSourceDocumentType(
    sourceType: string,
    docType: 'INV' | 'CN',
    rowId: string,
    line: DynAccountReceivableLineModel,
  ): void {
    const agrees =
      (sourceType === 'C' && docType === 'CN') ||
      (sourceType === 'I' && docType === 'INV');
    if (!agrees) {
      line.AddError(
        'DocType',
        `Row ${rowId}: expected Invoice / CN "${sourceType}" to agree with amount-derived Doc_Type "${docType}".`,
      );
    }
  }

  private validateHeaderConsistency(
    lines: DynAccountReceivableLineModel[],
  ): void {
    const groups = new Map<string, DynAccountReceivableLineModel[]>();
    for (const line of lines) {
      const group = groups.get(line.FreeTextNumber) ?? [];
      group.push(line);
      groups.set(line.FreeTextNumber, group);
    }

    const fields: Array<keyof DynAccountReceivableLineModel> = [
      'CustomerAccount',
      'InvoiceAccount',
      'DocumentDate',
      'InvoiceDate',
      'DueDate',
      'CurrencyCode',
      'BillingClassification',
      'PostingProfile',
      'SalesTaxGroup',
      'SalesTaxItemGroup',
      'TermsOfPayment',
      'HeaderDefaultDimensionDisplayValue',
      'HeaderFinTagDisplayValue',
      'DocType',
    ];

    for (const [freeTextNumber, group] of groups) {
      const firstLine = group[0];
      if (!firstLine) continue;
      for (const field of fields) {
        const expected = this.comparableValue(firstLine[field]);
        if (
          group.some((line) => this.comparableValue(line[field]) !== expected)
        ) {
          for (const line of group) {
            line.AddError(
              'HeaderConsistency',
              `Invoice "${freeTextNumber}" has inconsistent header field "${String(field)}" across its rows.`,
            );
          }
        }
      }
    }
  }

  private buildCustomersByTaxNumber(
    customers: ICustomer[],
  ): Map<string, ICustomer[]> {
    const customersByTaxNumber = new Map<string, ICustomer[]>();
    for (const customer of customers) {
      const taxNumber = this.normalizeTaxNumber(customer.taxExemptNumber);
      if (!taxNumber) continue;
      const matches = customersByTaxNumber.get(taxNumber) ?? [];
      matches.push(customer);
      customersByTaxNumber.set(taxNumber, matches);
    }
    return customersByTaxNumber;
  }

  private buildBillingCodeKeys(codes: IBillingCode[]): Set<string> {
    return new Set(
      codes
        .filter((code) => code.billingClassification && code.billingCode)
        .map((code) =>
          this.billingCodeKey(code.billingClassification, code.billingCode),
        ),
    );
  }

  private buildTermsByClassification(
    classifications: IBillingClassification[],
  ): Map<string, string> {
    const termsByClassification = new Map<string, string>();
    for (const classification of classifications) {
      if (
        classification.billingClassification &&
        classification.termsOfPayment
      ) {
        termsByClassification.set(
          classification.billingClassification.toLowerCase(),
          classification.termsOfPayment,
        );
      }
    }
    return termsByClassification;
  }

  private nextLineNumber(
    freeTextNumber: string,
    counters: Map<string, number>,
  ): number {
    const next = (counters.get(freeTextNumber) ?? 0) + 1;
    counters.set(freeTextNumber, next);
    return next;
  }

  private parseRequiredNumber(
    value: unknown,
    field: string,
    rowId: string,
    line: DynAccountReceivableLineModel,
  ): number {
    const cleaned = this.cleanSourceText(value).replace(/,/g, '');
    if (!cleaned) {
      line.AddError(field, `Row ${rowId}: ${field} is required.`);
      return 0;
    }
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      line.AddError(
        field,
        `Row ${rowId}: ${field} "${this.cleanSourceText(value)}" is not a valid number.`,
      );
      return 0;
    }
    return parsed;
  }

  private resolveDate(
    value: unknown,
    field: string,
    rowId: string,
    line: DynAccountReceivableLineModel,
  ): Date {
    const date = this.utilsService.toDate(value);
    if (date) return date;
    line.AddError(
      field,
      `Row ${rowId}: invalid or missing ${field} "${this.cleanSourceText(value)}".`,
    );
    return new Date(0);
  }

  private coaKey(
    code: unknown,
    type: unknown,
    direction: unknown,
    lineName: unknown,
  ): string {
    return [code, type, direction, lineName]
      .map((value) => this.normalizeStaticKey(value))
      .join('-');
  }

  private billingCodeKey(classification: string, code: string): string {
    return `${classification.trim().toLowerCase()}|${code.trim().toLowerCase()}`;
  }

  private normalizeStaticKey(value: unknown): string {
    return this.cleanSourceText(value).replace(/\s+/g, ' ').toUpperCase();
  }

  private normalizeTaxNumber(value: unknown): string {
    return this.cleanSourceText(value).replace(/[-/]/g, '');
  }

  private cleanSourceText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      return this.cleanSourceText((value as { result?: unknown }).result);
    }
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return [...String(value)]
      .filter((char) => {
        const code = char.charCodeAt(0);
        return !(
          code <= 31 ||
          (code >= 127 && code <= 159) ||
          code === 0x200b ||
          code === 0x200c ||
          code === 0x200d ||
          code === 0xfeff
        );
      })
      .join('')
      .trim();
  }

  private rowId(row: AccountReceivableShippingLinesFileModel): string {
    return this.cleanSourceText(row.Ser) || String(row.UniqueId ?? '');
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private comparableValue(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (value === null || value === undefined) return '';
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return JSON.stringify(value);
  }
}
