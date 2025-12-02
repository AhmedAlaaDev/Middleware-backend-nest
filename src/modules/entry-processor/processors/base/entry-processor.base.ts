import { D365FODataService } from '@/modules/d365fo/services/d365fo-data.service';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  EntryProcessorTypes,
  IEntryProcessor,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { MasterDataService } from '@/modules/master-data/master-data.service';

export abstract class EntryProcessorBase implements IEntryProcessor {
  abstract readonly entryProcessorType: EntryProcessorTypes;
  abstract readonly requiredDimensions: string[];

  protected billingClassifications: Map<
    string,
    Array<{ BillingCode: string }>
  > = new Map();

  constructor(
    protected readonly d365FODataService: D365FODataService,
    protected readonly masterDataService: MasterDataService,
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
    const capitalizeFirst = (input: string | null | undefined): string => {
      if (!input) return input || '';
      const lower = input.toLowerCase();
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
          ? parts[4].toLowerCase().includes('cai')
            ? '002'
            : parts[4].trim()
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
      dimensionsModel.location === '002' ? 'cai' : dimensionsModel.location,
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

    return parts.map((p) => p?.trim() || '').join('|');
  }

  protected prepareAccountReceivableLine(
    lineNumber: number,
    dimensions: AccountDimensionsModel,
    custLine: AccountReceivableFileModel,
    ledgerLine: AccountReceivableFileModel,
    billingCode: { BillingCode: string } | null,
    billingClassId: string,
  ): DynAccountReceivableLineDto {
    const termsOfPaymentDays =
      custLine.DUEDATE && custLine.TRANSDATE
        ? Math.ceil(
            (custLine.DUEDATE.getTime() - custLine.TRANSDATE.getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 0;

    const line = new DynAccountReceivableLineDto();
    line.sourceIds = [custLine.UniqueId.toString()];
    line.uniqueId = custLine.UniqueId;
    line.customId = custLine.UniqueId;
    line.lineNumber = lineNumber;
    line.freeTextNumber = custLine.getFormattedInvoiceNumber();
    line.documentDate = custLine.TRANSDATE;
    line.customerAccount = dimensions.subCustomer || '';
    line.headerDefaultDimensionDisplayValue =
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
    line.headerFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.invoiceTxt = dimensions.chargeType || '';
    line.description = custLine.TEXT || '';
    line.quantity = 1;
    line.unitPrice = ledgerLine.CREDITAMOUNT;
    line.amountCur = ledgerLine.CREDITAMOUNT;
    line.currencyCode = ledgerLine.CURRENCYCODE || '';
    line.salesTaxGroup = ledgerLine.getTaxGroup();
    line.salesTaxItemGroup = ledgerLine.getTaxGroupItem();
    line.defaultDimensionDisplayValue =
      custLine.modifiedLocationHeaderDefaultDimensionDisplayValue();
    line.lineFinTagDisplayValue = custLine.FINTAGDISPLAYVALUE || '';
    line.dueDate = custLine.DUEDATE;
    line.cashDiscountCode = undefined;
    line.cashDiscountDate = custLine.CASHDISCOUNTDATE;
    line.customerReference = custLine.getFormattedInvoiceNumber();
    line.eInvoiceIsLineSpecific = 'No';
    line.inclTax = 'Yes';
    line.invoiceAccount = dimensions.customer || '';
    line.invoiceDate = custLine.TRANSDATE;
    line.ledgerDimensionDisplayValue = dimensions.mainAccount || '';
    line.overrideSalesTax = 'No';
    line.postingProfile = 'Cust-PP';
    line.termsOfPayment = `${termsOfPaymentDays} Days`;
    line.dimensionModel = dimensions;
    line.billingClassification = billingClassId;

    if (billingCode) {
      line.billingCode = billingCode.BillingCode;
    } else {
      line.addError(
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
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (!dimensionsModel?.mainAccount) {
      ar.addError('MainAccount', 'Main Account is required');
      return;
    }
    if (
      !accounts.some((a) =>
        a.accountNumber
          .toLowerCase()
          .includes(dimensionsModel.mainAccount?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'MainAccount',
        `The main account ${dimensionsModel.mainAccount} does not exist in the system.`,
      );
    }
  }

  protected validateCustomerDimension(
    ar: DynDataModel,
    dimensions: string[],
  ): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.customer ||
      dimensionsModel.customer === '000' ||
      dimensionsModel.customer.toLowerCase() === '000'
    ) {
      ar.addError('CustomerDimensions', 'Customer is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.customer?.trim().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'CustomerDimensions',
        `The dimension ${dimensionsModel.customer} does not exist in the system.`,
      );
    }
  }

  protected validateSubCustomerDimension(
    ar: DynDataModel,
    dimensions: string[],
  ): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.subCustomer ||
      dimensionsModel.subCustomer === '000' ||
      dimensionsModel.subCustomer.toLowerCase() === '000'
    ) {
      ar.addError('SubCustomerDimensions', 'SubCustomer is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.subCustomer?.trimEnd().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'SubCustomerDimensions',
        `The dimension ${dimensionsModel.subCustomer} does not exist in the system.`,
      );
    }
  }

  protected validateChargeTypeDimension(
    ar: DynDataModel,
    dimensions: string[],
  ): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.chargeType ||
      dimensionsModel.chargeType === '000' ||
      dimensionsModel.chargeType.toLowerCase() === '000'
    ) {
      ar.addError('ChargeTypeDimensions', 'ChargeType is required');
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
      ar.addError(
        'ChargeTypeDimensions',
        `The dimension ${dimensionsModel.chargeType} does not exist in the system.`,
      );
    }
  }

  protected validateActivityName(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.activityName ||
      dimensionsModel.activityName === '000' ||
      dimensionsModel.activityName.toLowerCase() === '000'
    ) {
      ar.addError('ActivityNameDimensions', 'ActivityName is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.activityName?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'ActivityNameDimensions',
        `The dimension ${dimensionsModel.activityName} does not exist in the system.`,
      );
    }
  }

  protected validateCostCenter(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.costCenter ||
      dimensionsModel.costCenter === '000' ||
      dimensionsModel.costCenter.toLowerCase() === '000'
    ) {
      ar.addError('CostCenterDimensions', 'CostCenter is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.costCenter?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'CostCenterDimensions',
        `The dimension ${dimensionsModel.costCenter} does not exist in the system.`,
      );
    }
  }

  protected validateBusinessUnit(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.businessUnit ||
      dimensionsModel.businessUnit === '000' ||
      dimensionsModel.businessUnit.toLowerCase() === '000'
    ) {
      ar.addError('BusinessUnitDimensions', 'BusinessUnit is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.businessUnit?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'BusinessUnitDimensions',
        `The dimension ${dimensionsModel.businessUnit} does not exist in the system.`,
      );
    }
  }

  protected validateLocation(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.location ||
      dimensionsModel.location === '000' ||
      dimensionsModel.location.toLowerCase() === '000'
    ) {
      ar.addError('LocationDimensions', 'Location is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d.toLowerCase().includes(dimensionsModel.location?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'LocationDimensions',
        `The dimension ${dimensionsModel.location} does not exist in the system.`,
      );
    }
  }

  protected validateFreightType(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.freightType ||
      dimensionsModel.freightType === '000' ||
      dimensionsModel.freightType.toLowerCase() === '000'
    ) {
      ar.addError('FreightTypeDimensions', 'FreightType is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.freightType?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'FreightTypeDimensions',
        `The dimension ${dimensionsModel.freightType} does not exist in the system.`,
      );
    }
  }

  protected validateSalesMan(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.salesMan ||
      dimensionsModel.salesMan === '000' ||
      dimensionsModel.salesMan.toLowerCase() === '000'
    ) {
      ar.addError('SalesManDimensions', 'SalesMan is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d.toLowerCase().includes(dimensionsModel.salesMan?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'SalesManDimensions',
        `The dimension ${dimensionsModel.salesMan} does not exist in the system.`,
      );
    }
  }

  protected validateTruckerType(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.truckerType ||
      dimensionsModel.truckerType === '000' ||
      dimensionsModel.truckerType.toLowerCase() === '000'
    ) {
      ar.addError('TruckerTypeDimensions', 'TruckerType is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.truckerType?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'TruckerTypeDimensions',
        `The dimension ${dimensionsModel.truckerType} does not exist in the system.`,
      );
    }
  }

  protected validateTruckNumber(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.truckNumber ||
      dimensionsModel.truckNumber === '000' ||
      dimensionsModel.truckNumber.toLowerCase() === '000'
    ) {
      ar.addError('TruckNumberDimensions', 'TruckNumber is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.truckNumber?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'TruckNumberDimensions',
        `The dimension ${dimensionsModel.truckNumber} does not exist in the system.`,
      );
    }
  }

  protected validateDirection(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.direction ||
      dimensionsModel.direction === '000' ||
      dimensionsModel.direction.toLowerCase() === '000'
    ) {
      ar.addError('DirectionDimensions', 'Direction is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.direction?.toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'DirectionDimensions',
        `The dimension ${dimensionsModel.direction} does not exist in the system.`,
      );
    }
  }

  protected validateCoordinatorMan(
    ar: DynDataModel,
    dimensions: string[],
  ): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.coordinatorMan ||
      dimensionsModel.coordinatorMan === '000' ||
      dimensionsModel.coordinatorMan.toLowerCase() === '000'
    ) {
      ar.addError('CoordinatorManDimensions', 'CoordinatorMan is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.coordinatorMan?.trim().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'CoordinatorManDimensions',
        `The dimension ${dimensionsModel.coordinatorMan} does not exist in the system.`,
      );
    }
  }

  protected validateVendor(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.vendor ||
      dimensionsModel.vendor === '000' ||
      dimensionsModel.vendor.toLowerCase() === '000'
    ) {
      ar.addError('VendorDimensions', 'Vendor is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.vendor?.trim().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'VendorDimensions',
        `The dimension ${dimensionsModel.vendor} does not exist in the system.`,
      );
    }
  }

  protected validateSubVendor(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (
      !dimensionsModel?.subVendor ||
      dimensionsModel.subVendor === '000' ||
      dimensionsModel.subVendor.toLowerCase() === '000'
    ) {
      ar.addError('SubVendorDimensions', 'SubVendor is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.subVendor?.trim().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'SubVendorDimensions',
        `The dimension ${dimensionsModel.subVendor} does not exist in the system.`,
      );
    }
  }

  protected validateWorker(ar: DynDataModel, dimensions: string[]): void {
    const dimensionsModel = (ar as DynAccountReceivableLineDto).dimensionModel;
    if (!dimensionsModel?.worker) {
      ar.addError('WorkerDimensions', 'Worker is required');
      return;
    }
    if (
      !dimensions.some((d) =>
        d
          .toLowerCase()
          .includes(dimensionsModel.worker?.trim().toLowerCase() || ''),
      )
    ) {
      ar.addError(
        'WorkerDimensions',
        `The dimension ${dimensionsModel.worker} does not exist in the system.`,
      );
    }
  }
}
