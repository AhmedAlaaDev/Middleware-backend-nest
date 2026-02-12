import { Injectable, Logger } from '@nestjs/common';

import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { GetTaxItemGroupHeadingsQuery } from '@/modules/master-data/queries/get-tax-item-group-headings.query';

@Injectable()
export class AccountReceivableFreightEntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger(
    AccountReceivableFreightEntryProcessor.name,
  );
  readonly entryProcessorType = EntryProcessorTypes.AccountReceivableFreight;
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
  ];

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
    const results: DynAccountReceivableLineDto[] = [];
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
      const dimensionValues = await this.getFinancialDimensionValues(
        dimensionKey === 'SubCustomer' ? 'Customer' : dimensionKey,
      );
      dimensionsMap.set(dimensionKey, dimensionValues || []);
    }

    // Get charge type dimensions from billing codes
    const chargeTypeDims: string[] = [];
    if (billingClassId) {
      const billingCodes =
        this.billingClassifications.get(billingClassId) || [];
      chargeTypeDims.push(
        ...billingCodes.map((bc) => bc.billingCode).filter((bc) => bc),
      );
    }
    const uniqueChargeTypeDims = Array.from(new Set(chargeTypeDims));

    // Load tax item groups from DFO (for optional SalesTaxItemGroup validation)
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
      this.validateSalesTaxItemGroup(arLine, validTaxItemGroupCodes);
    }
    this.procLogger.debug('data Validated');
    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    const arLines = data as DynAccountReceivableLineDto[];

    // Group by invoice number
    const invoiceGroups = new Map<string, DynAccountReceivableLineDto[]>();
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
  ): DynAccountReceivableLineDto[] {
    const sortedLines = lines.sort((a, b) => {
      try {
        return a.getLineNumber() - b.getLineNumber();
      } catch {
        return 0;
      }
    });
    const accLines: DynAccountReceivableLineDto[] = [];
    let invLineCount = 1;
    let currentCustLine: AccountReceivableFileModel | null = null;
    for (const line of sortedLines) {
      const type = line.ACCOUNTTYPE?.toLowerCase();
      if (type === 'cust') {
        currentCustLine = line;
        continue;
      }
      if (type === 'ledger' && currentCustLine !== null) {
        const dims = this.parseToDimensions(line.ACCOUNTDISPLAYVALUE || '');
        this.applySubCustomerMapping(dims, accounts);
        line.ACCOUNTDISPLAYVALUE = this.convertToStringDimensions(dims);
        const billingCode = this.findBillingCode(
          billingCodes,
          billingClassId,
          dims.chargeType,
        );
        const arLine = this.prepareAccountReceivableLine(
          invLineCount,
          dims,
          currentCustLine,
          line,
          billingCode,
          billingClassId || '',
        );
        invLineCount++;
        accLines.push(arLine);
      }
    }
    return accLines;
  }

  private applySubCustomerMapping(dims: any, accounts: any[]): void {
    const matchingAccount = accounts.find((a: any) =>
      a.customerAccount
        ?.toLowerCase()
        .includes(dims.customer?.toLowerCase() || ''),
    );
    if (matchingAccount && dims.subCustomer) {
      const mappingAccount = accounts.find((a: any) =>
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
    billingCodes: any[],
    billingClassification?: string,
    chargeType?: string,
  ): any {
    if (!chargeType) return null;
    const lowerCharge = chargeType.toLowerCase();
    const lowerClass = billingClassification?.toLowerCase();
    let best: any = null;
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
}
