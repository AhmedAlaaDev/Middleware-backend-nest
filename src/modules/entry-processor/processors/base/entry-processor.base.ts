import { QueryBus } from '@nestjs/cqrs';

import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  IEntryProcessor,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { GetFinancialDimensionValueQuery } from '@/modules/master-data/queries/get-financial-dimension-values.query';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import { BillingCode } from '@/modules/master-data/schemas/billing-code.schema';

export abstract class EntryProcessorBase implements IEntryProcessor {
  abstract readonly entryProcessorType: EntryProcessorTypes;
  abstract readonly requiredDimensions: readonly string[];

  protected billingClassifications: Map<string, Array<IBillingCode>> =
    new Map();

  constructor(
    protected readonly customerInvoiceService: CustomerInvoiceService,
    protected readonly queryBus: QueryBus,
    protected readonly db: DBService,
  ) {}

  abstract formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void>;

  parseToDimensions(dimensionString: string): AccountDimensionsModel {
    const capitalizeFirst = (input: any): string => {
      if (input === null || input === undefined) return '';
      const s = typeof input === 'string' ? input : String(input);
      const lower = s.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    };

    if (!dimensionString || !dimensionString.trim()) {
      return {
        mainAccount: undefined,
        costCenter: undefined,
        activityName: undefined,
        businessUnit: undefined,
        location: undefined,
        customer: undefined,
        subCustomer: undefined,
        vendor: undefined,
        subVendor: undefined,
        chargeType: undefined,
        salesMan: undefined,
        coordinatorMan: undefined,
        freightType: 'Payable',
        truckerType: undefined,
        truckNumber: undefined,
        direction: undefined,
        worker: undefined,
        fixedAsset: undefined,
        lease: undefined,
      };
    }

    const parts = dimensionString.split('|');

    return {
      mainAccount:
        parts.length > 0 ? capitalizeFirst(parts[0])?.trim() : undefined,
      costCenter:
        parts.length > 1 ? capitalizeFirst(parts[1])?.trim() : undefined,
      activityName:
        parts.length > 2 ? capitalizeFirst(parts[2])?.trim() : undefined,
      businessUnit:
        parts.length > 3 ? capitalizeFirst(parts[3])?.trim() : undefined,
      location:
        parts.length > 4
          ? String(parts[4]).toLowerCase().includes('cai')
            ? '002'
            : String(parts[4]).trim()
          : undefined,
      customer:
        parts.length > 5 ? capitalizeFirst(parts[5])?.trim() : undefined,
      subCustomer:
        parts.length > 6 ? capitalizeFirst(parts[6])?.trim() : undefined,
      vendor: parts.length > 7 ? capitalizeFirst(parts[7])?.trim() : undefined,
      subVendor:
        parts.length > 8 ? capitalizeFirst(parts[8])?.trim() : undefined,
      chargeType:
        parts.length > 9 ? capitalizeFirst(parts[9])?.trim() : undefined,
      salesMan:
        parts.length > 10 ? capitalizeFirst(parts[10])?.trim() : undefined,
      coordinatorMan:
        parts.length > 11 ? capitalizeFirst(parts[11])?.trim() : undefined,
      freightType:
        parts.length > 12 && capitalizeFirst(parts[12])?.trim()
          ? capitalizeFirst(parts[12])?.trim() || 'Payable'
          : 'Payable',
      truckerType:
        parts.length > 13 ? capitalizeFirst(parts[13])?.trim() : undefined,
      truckNumber:
        parts.length > 14 ? capitalizeFirst(parts[14])?.trim() : undefined,
      direction:
        parts.length > 15 ? capitalizeFirst(parts[15])?.trim() : undefined,
      worker:
        parts.length > 16 ? capitalizeFirst(parts[16])?.trim() : undefined,
      fixedAsset:
        parts.length > 17 ? capitalizeFirst(parts[17])?.trim() : undefined,
      lease: parts.length > 18 ? capitalizeFirst(parts[18])?.trim() : undefined,
    };
  }

  convertToStringDimensions(
    dimensionsModel: AccountDimensionsModel | null,
  ): string {
    if (!dimensionsModel) {
      return '';
    }

    const parts = [
      dimensionsModel.mainAccount,
      dimensionsModel.costCenter,
      dimensionsModel.activityName,
      dimensionsModel.businessUnit,
      String(dimensionsModel.location) === '002'
        ? 'cai'
        : dimensionsModel.location,
      dimensionsModel.customer,
      dimensionsModel.subCustomer,
      dimensionsModel.vendor,
      dimensionsModel.subVendor,
      dimensionsModel.chargeType,
      dimensionsModel.salesMan,
      dimensionsModel.coordinatorMan,
      dimensionsModel.freightType || 'Payable',
      dimensionsModel.truckerType,
      dimensionsModel.truckNumber,
      dimensionsModel.direction,
      dimensionsModel.worker,
      dimensionsModel.fixedAsset,
      dimensionsModel.lease,
    ];

    const normalize = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' ? v : String(v);
      return s.trim();
    };

    return parts.map((p) => normalize(p)).join('|');
  }

  protected prepareAccountReceivableLine(
    lineNumber: number,
    dimensions: AccountDimensionsModel,
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    billingCode: BillingCode | null,
    billingClassId: string,
  ): DynAccountReceivableLineDto {
    const transDate = this.coerceToDate(custLine.TRANSDATE) as Date;
    const dueDate = this.coerceToDate(custLine.DUEDATE);
    const cashDiscountDate = this.coerceToDate(custLine.CASHDISCOUNTDATE);
    const termsOfPaymentDays =
      dueDate && transDate
        ? Math.ceil(
            (dueDate.getTime() - transDate.getTime()) / (1000 * 60 * 60 * 24),
          )
        : 0;

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
      false, // Base implementation is for invoices, not credit notes
    );
    line.DocumentDate = transDate;
    line.CustomerAccount = dimensions.subCustomer || '';
    line.HeaderDefaultDimensionDisplayValue =
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
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
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
    line.LineFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.DueDate = dueDate || undefined;
    line.CashDiscountCode = '';
    line.CashDiscountDate = cashDiscountDate || undefined;
    line.CustomerReference = this.formatFreeTextNumberWithSuffix(
      custLine.INVOICE || '',
      billingClassId,
      false, // Base implementation is for invoices, not credit notes
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

    return line;
  }

  protected validateMainAccount(
    ar: DynDataModel,
    accounts: Array<{ accountNumber: string }>,
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (!dimensionsModel?.mainAccount) {
      ar.AddError('MainAccount', 'Main Account is required');
      return;
    }
    if (
      !accounts.some((a) =>
        a.accountNumber
          .toLowerCase()
          .includes(dimensionsModel.mainAccount?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'MainAccount',
        `The main account ${dimensionsModel.mainAccount} does not exist in the system.`,
      );
    }
  }

  /**
   * Validates that the line's Item sales tax group (if present) exists in D365FO.
   * Not required; only validated when a value is provided.
   */
  protected validateSalesTaxItemGroup(
    ar: DynDataModel,
    validTaxItemGroupCodes: Set<string>,
  ): void {
    const line = ar as DynAccountReceivableLineDto;
    const value = (line.SalesTaxItemGroup || '').trim();
    if (!value) return;
    if (!validTaxItemGroupCodes.has(value)) {
      ar.AddError(
        'SalesTaxItemGroup',
        `The item sales tax group '${value}' does not exist in D365FO. Please sync Tax Item Group Headings from D365FO or use a valid code.`,
      );
    }
  }

  protected coerceToDate(input: any): Date | null {
    if (!input) return null;
    if (input instanceof Date) return input;
    if (typeof input === 'string') {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof input === 'number') {
      const ms = Math.round((input - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  protected buildSourceId(
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    lineNumber: number,
  ): string {
    if (custLine?.UniqueId !== undefined && custLine?.UniqueId !== null) {
      return String(custLine.UniqueId);
    }
    const v = custLine?.VOUCHER || '';
    const i = custLine?.INVOICE || '';
    const candidate = `${v}_${i}_${lineNumber}`;
    return candidate;
  }

  protected validateCustomerDimension(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.customer ||
      dimensionsModel.customer === '000' ||
      dimensionsModel.customer.toLowerCase() === '000'
    ) {
      ar.AddError('CustomerDimensions', 'Customer is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.customer?.trim().toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'CustomerDimensions',
        `The dimension ${dimensionsModel.customer} does not exist in the system.`,
      );
    }
  }

  protected validateSubCustomerDimension(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.subCustomer ||
      dimensionsModel.subCustomer === '000' ||
      dimensionsModel.subCustomer.toLowerCase() === '000'
    ) {
      ar.AddError('SubCustomerDimensions', 'SubCustomer is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.subCustomer?.trimEnd().toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'SubCustomerDimensions',
        `The dimension ${dimensionsModel.subCustomer} does not exist in the system.`,
      );
    }
  }

  protected validateChargeTypeDimension(
    ar: DynDataModel,
    dimensions: string[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.chargeType ||
      dimensionsModel.chargeType === '000' ||
      dimensionsModel.chargeType.toLowerCase() === '000'
    ) {
      ar.AddError('ChargeTypeDimensions', 'ChargeType is required');
      return;
    }
    const normalizedChargeType =
      dimensionsModel.chargeType?.toLowerCase() || '';
    if (
      !dimensions.some((d) => {
        const normalizedDim = d
          .toLowerCase()
          .replace('-of', '')
          .replace('-or', '');
        return normalizedDim === normalizedChargeType;
      })
    ) {
      ar.AddError(
        'ChargeTypeDimensions',
        `The dimension ${dimensionsModel.chargeType} does not exist in the system.`,
      );
    }
  }

  protected validateActivityName(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.activityName ||
      dimensionsModel.activityName === '000' ||
      dimensionsModel.activityName.toLowerCase() === '000'
    ) {
      ar.AddError('ActivityNameDimensions', 'ActivityName is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.activityName?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'ActivityNameDimensions',
        `The dimension ${dimensionsModel.activityName} does not exist in the system.`,
      );
    }
  }

  protected validateCostCenter(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.costCenter ||
      dimensionsModel.costCenter === '000' ||
      dimensionsModel.costCenter.toLowerCase() === '000'
    ) {
      ar.AddError('CostCenterDimensions', 'CostCenter is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.costCenter?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'CostCenterDimensions',
        `The dimension ${dimensionsModel.costCenter} does not exist in the system.`,
      );
    }
  }

  protected validateBusinessUnit(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.businessUnit ||
      dimensionsModel.businessUnit === '000' ||
      dimensionsModel.businessUnit.toLowerCase() === '000'
    ) {
      ar.AddError('BusinessUnitDimensions', 'BusinessUnit is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.businessUnit?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'BusinessUnitDimensions',
        `The dimension ${dimensionsModel.businessUnit} does not exist in the system.`,
      );
    }
  }

  protected validateLocation(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.location ||
      dimensionsModel.location === '000' ||
      dimensionsModel.location.toLowerCase() === '000'
    ) {
      ar.AddError('LocationDimensions', 'Location is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.location?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'LocationDimensions',
        `The dimension ${dimensionsModel.location} does not exist in the system.`,
      );
    }
  }

  protected validateFreightType(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.freightType ||
      dimensionsModel.freightType === '000' ||
      dimensionsModel.freightType.toLowerCase() === '000'
    ) {
      ar.AddError('FreightTypeDimensions', 'FreightType is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.freightType?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'FreightTypeDimensions',
        `The dimension ${dimensionsModel.freightType} does not exist in the system.`,
      );
    }
  }

  protected validateSalesMan(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.salesMan ||
      dimensionsModel.salesMan === '000' ||
      dimensionsModel.salesMan.toLowerCase() === '000'
    ) {
      ar.AddError('SalesManDimensions', 'SalesMan is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.salesMan?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'SalesManDimensions',
        `The dimension ${dimensionsModel.salesMan} does not exist in the system.`,
      );
    }
  }

  protected validateTruckerType(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.truckerType ||
      dimensionsModel.truckerType === '000' ||
      dimensionsModel.truckerType.toLowerCase() === '000'
    ) {
      ar.AddError('TruckerTypeDimensions', 'TruckerType is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.truckerType?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'TruckerTypeDimensions',
        `The dimension ${dimensionsModel.truckerType} does not exist in the system.`,
      );
    }
  }

  protected validateTruckNumber(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean = true,
  ): void {
    const dimensionsModel = ar.DimensionModel;

    // Only when isRequired=true: add "TruckNumber is required" if missing or '000'
    if (
      isRequired &&
      (!dimensionsModel?.truckNumber ||
        dimensionsModel.truckNumber === '000' ||
        dimensionsModel.truckNumber.toLowerCase() === '000')
    ) {
      ar.AddError('TruckNumberDimensions', 'TruckNumber is required');
    }

    // Always: when a truck number is present, verify it exists in the system
    if (
      dimensionsModel?.truckNumber &&
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.truckNumber?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'TruckNumberDimensions',
        `The dimension ${dimensionsModel.truckNumber} does not exist in the system.`,
      );
    }
  }

  protected validateDirection(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.direction ||
      dimensionsModel.direction === '000' ||
      dimensionsModel.direction.toLowerCase() === '000'
    ) {
      ar.AddError('DirectionDimensions', 'Direction is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.direction?.toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'DirectionDimensions',
        `The dimension ${dimensionsModel.direction} does not exist in the system.`,
      );
    }
  }

  protected validateCoordinatorMan(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean = true,
  ): void {
    const dimensionsModel = ar.DimensionModel;
    const coordinatorMan =
      dimensionsModel?.coordinatorMan?.trim().toLowerCase() || '';
    if (
      isRequired &&
      (!coordinatorMan ||
        coordinatorMan === '000' ||
        coordinatorMan.toLowerCase() === '000')
    ) {
      ar.AddError('CoordinatorManDimensions', 'CoordinatorMan is required');
      return;
    }
    if (
      coordinatorMan &&
      !dimensions.some((d) =>
        (d?.value || '').toLowerCase().includes(coordinatorMan),
      )
    ) {
      ar.AddError(
        'CoordinatorManDimensions',
        `The dimension ${coordinatorMan} does not exist in the system.`,
      );
    }
  }

  protected validateVendor(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.vendor ||
      dimensionsModel.vendor === '000' ||
      dimensionsModel.vendor.toLowerCase() === '000'
    ) {
      ar.AddError('VendorDimensions', 'Vendor is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.vendor?.trim().toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'VendorDimensions',
        `The dimension ${dimensionsModel.vendor} does not exist in the system.`,
      );
    }
  }

  protected validateSubVendor(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
  ): void {
    const dimensionsModel = ar.DimensionModel;
    if (
      !dimensionsModel?.subVendor ||
      dimensionsModel.subVendor === '000' ||
      dimensionsModel.subVendor.toLowerCase() === '000'
    ) {
      ar.AddError('SubVendorDimensions', 'SubVendor is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        (d?.value || '')
          .toLowerCase()
          .includes(dimensionsModel.subVendor?.trim().toLowerCase() || ''),
      )
    ) {
      ar.AddError(
        'SubVendorDimensions',
        `The dimension ${dimensionsModel.subVendor} does not exist in the system.`,
      );
    }
  }

  protected validateWorker(
    ar: DynDataModel,
    dimensions: IFinancialDimensionValue[],
    isRequired: boolean = true,
  ): void {
    const dimensionsModel = ar.DimensionModel;
    const worker = dimensionsModel?.worker?.trim().toLowerCase() || '';
    if (
      isRequired &&
      (!worker || worker === '000' || worker.toLowerCase() === '000')
    ) {
      ar.AddError('WorkerDimensions', 'Worker is required');
      return;
    }
    if (
      worker &&
      !dimensions.some((d) => (d?.value || '').toLowerCase().includes(worker))
    ) {
      ar.AddError(
        'WorkerDimensions',
        `The dimension ${worker} does not exist in the system.`,
      );
    }
  }

  /**
   * Get account customer invoice mappings by service type
   */
  protected async getAccountCustomerInvoiceMappings(serviceType: ServiceTypes) {
    const res = await this.queryBus.execute(
      new GetAccountMappingsQuery({ serviceType }),
    );
    return res.items;
  }

  /**
   * Get all main accounts
   */
  protected async getAllMainAccounts() {
    const res = await this.queryBus.execute(
      new GetMainAccountsQuery({ chartNumber: 'Chart of Accounts' }),
    );
    return res?.items || [];
  }

  /**
   * Get financial dimension values as string array by dimension key
   */
  protected async getFinancialDimensionValues(
    financialKey: string,
  ): Promise<IFinancialDimensionValue[]> {
    const values = await this.queryBus.execute(
      new GetFinancialDimensionValueQuery(financialKey),
    );

    return values;
  }

  protected formatVoucherNumber(voucher: number, prefix: string): string {
    return `${prefix}-${String(voucher).padStart(9, '0')}`;
  }

  protected formatBatchNumber(batch: number, prefix?: string): string {
    return `${prefix || 'Mesco'}-${String(batch).padStart(9, '0')}`;
  }

  /**
   * Formats FreeTextNumber as "9 digits/suffix" based on billing classification and invoice type
   * @param invoiceNumber - The invoice number (may contain existing suffix)
   * @param billingClassId - The billing classification (e.g., "INV-FW", "INV-TR", "OR-FW", "OR-TR", "OF-FW")
   * @param isCreditNote - Whether this is a credit note (true) or invoice (false)
   * @returns Formatted string like "000052619/CN-FW" or "000052619/Invoice"
   */
  protected formatFreeTextNumberWithSuffix(
    invoiceNumber: string,
    billingClassId: string,
    isCreditNote: boolean,
  ): string {
    // Extract numeric part from invoice number (handle cases where it might already have a suffix)
    let numberPart = invoiceNumber || '';

    numberPart = numberPart.split('-')?.pop()?.trim() || '';

    // Parse and pad to 9 digits
    const number = parseInt(numberPart, 10);
    const paddedNumber = !isNaN(number)
      ? number.toString().padStart(9, '0')
      : '000000000';

    // Determine suffix based on isCreditNote and billingClassId
    const normalizedBillingClass = (billingClassId || '').toLowerCase().trim();
    let suffix: string;

    if (isCreditNote) {
      // For Credit Notes (FREETEXTTYPE = "CN")
      switch (normalizedBillingClass) {
        case 'inv-fw':
          suffix = 'CN-FW';
          break;
        case 'inv-tr':
          suffix = 'CN-TR';
          break;
        case 'of-fw':
          suffix = 'CN-FW';
          break;
        case 'or-fw':
          suffix = 'CN-FW';
          break;
        case 'or-tr':
          suffix = 'CN-TR';
          break;
        default:
          // Default for credit notes
          suffix = 'CN-FW';
          break;
      }
    } else {
      // For Invoices (FREETEXTTYPE = "INV")
      switch (normalizedBillingClass) {
        case 'inv-fw':
          suffix = 'Invoice';
          break;
        case 'inv-tr':
          suffix = 'Invoice';
          break;
        case 'of-fw':
          suffix = 'OF-FW';
          break;
        case 'or-fw':
          suffix = 'OR-FW';
          break;
        case 'or-tr':
          suffix = 'OR-TR';
          break;
        default:
          // Default for invoices
          suffix = 'Invoice';
          break;
      }
    }

    return `${paddedNumber}/${suffix}`;
  }

  /**
   * Normalizes currency code to uppercase (D365FO requirement)
   * @param currency Currency code to normalize
   * @returns Uppercase 3-character currency code
   * @throws Error if currency is invalid
   */
  protected normalizeCurrencyCode(currency?: string | null): string {
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency code is required and must be a string');
    }
    const normalized = currency.trim().toUpperCase();
    if (normalized.length !== 3) {
      throw new Error(
        `Invalid currency code format: ${currency}. Must be 3 characters.`,
      );
    }
    return normalized;
  }

  /**
   * Normalizes company code to uppercase (D365FO requirement)
   * @param company Company code to normalize
   * @returns Uppercase company code
   * @throws Error if company is invalid
   */
  protected normalizeCompanyCode(company?: string | null): string {
    if (!company || typeof company !== 'string') {
      throw new Error('Company code is required and must be a string');
    }
    return company.trim().toUpperCase();
  }

  /**
   * Normalizes TransactionType enum value
   * D365FO expects "Vend" (capitalized), not "vendor" (lowercase)
   * @param transactionType Transaction type to normalize
   * @returns Normalized transaction type ("Vend" by default)
   */
  protected normalizeTransactionType(transactionType?: string | null): string {
    if (!transactionType || typeof transactionType !== 'string') {
      return 'Vend'; // Default
    }
    const normalized = transactionType.trim();
    // Map common variations to D365FO enum values
    const mapping: Record<string, string> = {
      vendor: 'Vend',
      Vendor: 'Vend',
      VENDOR: 'Vend',
      vend: 'Vend',
      Vend: 'Vend',
    };
    return mapping[normalized.toLowerCase()] || normalized;
  }
}
