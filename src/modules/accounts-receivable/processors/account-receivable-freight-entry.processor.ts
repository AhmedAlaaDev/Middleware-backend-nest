import { Injectable, Logger } from '@nestjs/common';

import {
  DynAccountReceivableLineModel,
  AccountReceivableFileModel,
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
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { BillingCode } from '@/modules/master-data/schemas/billing-code.schema';

@Injectable()
export class AccountReceivableFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableFreightEntryProcessor.name,
  );
  readonly entryProcessorType = EntryProcessorTypes.AccountReceivableFreight;
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
    billingClassId?: string,
  ): Promise<DynDataModel[]> {
    this.company = company;
    await this.warmupProcessorData({
      taxItemGroupCodes: true,
      paymentTerms: true,
    });
    // Load customer-account mappings for the Freight service
    const accounts = await this.getAccountCustomerInvoiceMappings(
      ServiceTypes.Freight,
    );
    // Convert raw rows (Excel) into typed models we can safely work with
    const arData = this.mapToModels(data);
    // Group all lines by voucher+invoice to process each invoice cohesively
    const groups = this.groupByVoucherInvoice(arData);
    // Fetch billing codes for the given company (used to derive charge type)
    const billingCodesRes = await this.queryBus.execute(
      new GetBillingCodesQuery({ company }),
    );
    const billingCodes = billingCodesRes.items;

    // Cache billing classification codes, if provided, for downstream validation
    if (billingClassId) {
      this.billingClassifications.set(billingClassId, billingCodes);
    }
    // Enrich each grouped invoice into Account Receivable lines
    const results: DynAccountReceivableLineModel[] = [];
    for (const [, lines] of groups.entries()) {
      const enriched = this.enrichGroup(
        lines,
        billingCodes,
        billingClassId,
        accounts,
      );
      results.push(...enriched);
    }
    // Return the aggregated enriched AR lines
    return results;
  }

  validateAsync(
    data: DynDataModel[],
    _company: string,
    billingClassId?: string,
  ): DynDataModel[] {
    const arData = data as DynAccountReceivableLineModel[];

    const chargeTypeDims: string[] = [];
    if (billingClassId) {
      const billingCodes =
        this.billingClassifications.get(billingClassId) || [];
      chargeTypeDims.push(
        ...billingCodes.map((bc) => bc.billingCode).filter((bc) => bc),
      );
    }
    const uniqueChargeTypeDims = Array.from(new Set(chargeTypeDims));

    for (const arLine of arData) {
      this.validateDimensionsForLine(arLine, {
        chargeTypeDims: uniqueChargeTypeDims,
      });
      this.validateSalesTaxItemGroupForLine(arLine);
      validateTermsOfPayment(arLine, this.getValidPaymentTermNames());
    }
    this.procLogger.debug('data Validated');
    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    const arLines = data as DynAccountReceivableLineModel[];

    // Group by invoice number
    const invoiceGroups = new Map<string, DynAccountReceivableLineModel[]>();
    for (const line of arLines) {
      const invoiceNum = line.FreeTextNumber || '';
      if (!invoiceGroups.has(invoiceNum)) {
        invoiceGroups.set(invoiceNum, []);
      }
      invoiceGroups.get(invoiceNum)!.push(line);
    }

    // Process each invoice
    for (const [_invoiceNumber, lines] of invoiceGroups.entries()) {
      if (lines.length === 0) continue;

      const firstLine = lines[0];
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
    const invoiceGroups = new Map<string, AccountReceivableFileModel[]>();
    for (const line of arData) {
      const key = `${line.VOUCHER || ''}_${line.INVOICE || ''}`;
      if (!invoiceGroups.has(key)) {
        invoiceGroups.set(key, []);
      }
      invoiceGroups.get(key)!.push(line);
    }
    return invoiceGroups;
  }

  private enrichGroup(
    lines: AccountReceivableFileModel[],
    billingCodes: any[],
    billingClassId: string | undefined,
    accounts: any[],
  ): DynAccountReceivableLineModel[] {
    const sortedLines = lines.sort((a, b) => {
      try {
        return a.getLineNumber() - b.getLineNumber();
      } catch {
        return 0;
      }
    });
    const accLines: DynAccountReceivableLineModel[] = [];
    let invLineCount = 1;
    let currentCustLine: AccountReceivableFileModel | null = null;
    for (const line of sortedLines) {
      const type = line.ACCOUNTTYPE?.toLowerCase();
      if (type === 'cust') {
        currentCustLine = line;
        continue;
      }
      if (type === 'ledger' && currentCustLine !== null) {
        const rawDimensionString = line.ACCOUNTDISPLAYVALUE || '';
        const segmentLength =
          this.utilsService.getDimensionSegmentLength(rawDimensionString);
        const dims = this.utilsService.parseDimensionString(rawDimensionString);
        this.applySubCustomerMapping(dims, accounts);
        line.ACCOUNTDISPLAYVALUE = this.utilsService.toDimensionString(dims);
        const billingCode = this.findBillingCode(
          billingCodes,
          dims.chargeType,
          billingClassId,
        );
        const arLine = this.prepareAccountReceivableLine(
          invLineCount,
          dims,
          currentCustLine,
          line,
          billingCode,
          billingClassId || '',
          segmentLength,
        );
        invLineCount++;
        accLines.push(arLine);
      }
    }
    return accLines;
  }

  private buildSourceId(
    custLine: AccountReceivableFileModel,
    _ledgerLine: AccountReceivableFileModel,
    lineNumber: number,
  ): string {
    if (custLine?.UniqueId !== undefined && custLine?.UniqueId !== null) {
      return String(custLine.UniqueId);
    }
    return `${custLine?.VOUCHER || ''}_${custLine?.INVOICE || ''}_${lineNumber}`;
  }

  private applySubCustomerMapping(
    dims: EntryDimensionsModel,
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

  private prepareAccountReceivableLine(
    lineNumber: number,
    dimensions: EntryDimensionsModel,
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    billingCode: BillingCode | null,
    billingClassId: string,
    dimensionSegmentLength: number,
  ): DynAccountReceivableLineModel {
    const transDate = this.utilsService.toDate(custLine.TRANSDATE) as Date;
    const dueDate = this.utilsService.toDate(custLine.DUEDATE);
    const cashDiscountDate = this.utilsService.toDate(
      custLine.CASHDISCOUNTDATE,
    );
    const termsOfPaymentDays =
      dueDate && transDate
        ? Math.ceil(
            (dueDate.getTime() - transDate.getTime()) / (1000 * 60 * 60 * 24),
          )
        : 0;

    const line = new DynAccountReceivableLineModel();
    const sourceId = this.buildSourceId(custLine, ledgerLine, lineNumber);
    line.SourceIds = [sourceId];
    line.UniqueId =
      typeof custLine.UniqueId === 'number' ? custLine.UniqueId : lineNumber;
    line.CustomId =
      typeof custLine.UniqueId === 'number' ? custLine.UniqueId : lineNumber;
    line.LineNumber = lineNumber;
    line.FreeTextNumber = this.utilsService.formatFreeTextNumberWithSuffix(
      custLine.INVOICE || '',
      billingClassId,
      false,
    );
    line.DocumentDate = transDate;
    line.CustomerAccount = dimensions.subCustomer || '';
    line.HeaderDefaultDimensionDisplayValue =
      custLine.enrichedDefaultDimensionDisplayValue(dimensions);
    line.HeaderFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.InvoiceTxt = dimensions.chargeType || '';
    line.Description = custLine.TEXT || '';
    line.Quantity = 1;
    line.UnitPrice = ledgerLine.CREDITAMOUNT;
    line.AmountCur = ledgerLine.CREDITAMOUNT;
    line.CurrencyCode = ledgerLine.CURRENCYCODE || '';
    line.SalesTaxGroup = ledgerLine.getTaxGroup();
    line.SalesTaxItemGroup = ledgerLine.getTaxGroupItem();
    line.DefaultDimensionDisplayValue =
      custLine.enrichedDefaultDimensionDisplayValue(dimensions);
    line.LineFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.DueDate = dueDate || undefined;
    line.CashDiscountCode = '';
    line.CashDiscountDate = cashDiscountDate || undefined;
    line.CustomerReference = this.utilsService.formatFreeTextNumberWithSuffix(
      custLine.INVOICE || '',
      billingClassId,
      false,
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

    if (billingCode) {
      line.BillingCode = billingCode.billingCode;
    } else {
      line.AddError(
        'BillingCode',
        `Could not found a billing code related to this charge type ${dimensions.chargeType}`,
      );
    }

    if (
      !this.utilsService.isValidDimensionSegmentLength(dimensionSegmentLength)
    ) {
      line.AddError(
        'Dimensions',
        `Invalid dimensions segment length: ${dimensionSegmentLength}. Expected 19 or 20 segments.`,
      );
    }

    return line;
  }
}
