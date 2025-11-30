import { Injectable } from '@nestjs/common';
import { EntryProcessorTypes } from '../../data-batches/schemas/data-batch.schema';
import { EntryProcessorBase } from './base/entry-processor.base';
import { D365FODataService } from '../../d365fo/services/d365fo-data.service';
import { MasterDataService, ServiceTypes } from '../../master-data/services/master-data.service';
import { PrismaService } from '../../database/services/prisma.service';
import { RawDataModel, DynDataModel } from '../interfaces/entry-processor.interface';
import { AccountReceivableFileModel } from '../models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '../models/dyn-account-receivable-line.dto';
import { AccountDimensionsModel } from '../models/account-dimensions.model';

@Injectable()
export class AccountReceivableFreightEntryProcessor extends EntryProcessorBase {
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
    d365FODataService: D365FODataService,
    masterDataService: MasterDataService,
    prisma: PrismaService,
  ) {
    super(d365FODataService, masterDataService, prisma);
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]> {
    // Load master data (cached)
    const accounts = await this.masterDataService.getAccountCustomerInvoiceMappings(
      ServiceTypes.Freight,
    );

    const arData = data.map((raw) => {
      const model = new AccountReceivableFileModel();
      Object.assign(model, raw);
      return model;
    }) as AccountReceivableFileModel[];

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

    const billingCodes = await this.d365FODataService.getBillingCodeListAsync(
      company,
      billingClassId || '',
      0,
      5000,
    );

    if (billingClassId) {
      this.billingClassifications.set(billingClassId, billingCodes);
    }

    for (const [key, lines] of invoiceGroups.entries()) {
      // Sort lines by line number
      const sortedLines = lines.sort((a, b) => {
        try {
          return a.getLineNumber() - b.getLineNumber();
        } catch {
          return 0;
        }
      });

      let invLineCount = 1;
      let currentCustLine: AccountReceivableFileModel | null = null;

      for (const line of sortedLines) {
        if (line.ACCOUNTTYPE?.toLowerCase() === 'cust') {
          currentCustLine = line;
          continue;
        } else if (
          line.ACCOUNTTYPE?.toLowerCase() === 'ledger' &&
          currentCustLine !== null
        ) {
          const accountDimensions = this.parseToDimensions(
            line.ACCOUNTDISPLAYVALUE || '',
          );

          // Apply account mapping if needed
          const matchingAccount = accounts.find((a: any) =>
            a.customerAccount
              ?.toLowerCase()
              .includes(accountDimensions.customer?.toLowerCase() || ''),
          );
          if (matchingAccount && accountDimensions.subCustomer) {
            const mappingAccount = accounts.find((a: any) =>
              a.customerAccount
                ?.toLowerCase()
                .includes(accountDimensions.subCustomer?.toLowerCase() || ''),
            );
            if (mappingAccount) {
              accountDimensions.subCustomer = mappingAccount.invoiceAccount;
            }
          }

          line.ACCOUNTDISPLAYVALUE = this.convertToStringDimensions(
            accountDimensions,
          );

          const billingCode = billingCodes.find((bc: any) =>
            bc.BillingCode?.toLowerCase().includes(
              accountDimensions.chargeType?.toLowerCase() || '',
            ),
          ) || null;

          const arLine = this.prepareAccountReceivableLine(
            invLineCount,
            accountDimensions,
            currentCustLine,
            line,
            billingCode,
            billingClassId || '',
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
    // Load dimensions and accounts
    const accounts =
      await this.masterDataService.getAllMainAccounts();

    const dimensionsMap = new Map<string, string[]>();
    for (const dimensionKey of this.requiredDimensions) {
      const dimensionValues =
        await this.masterDataService.getFinancialDimensionValues(dimensionKey);
      dimensionsMap.set(dimensionKey, dimensionValues);
    }

    const arData = data as DynAccountReceivableLineDto[];

    // Get charge type dimensions from billing codes
    const chargeTypeDims: string[] = [];
    if (billingClassId) {
      const billingCodes = this.billingClassifications.get(billingClassId) || [];
      chargeTypeDims.push(
        ...billingCodes.map((bc) => bc.BillingCode).filter((bc) => bc),
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
      this.validateBusinessUnit(arLine, dimensionsMap.get('BusinessUnit') || []);
      this.validateLocation(arLine, dimensionsMap.get('Location') || []);
      this.validateCustomerDimension(arLine, dimensionsMap.get('Customer') || []);
      this.validateSubCustomerDimension(
        arLine,
        dimensionsMap.get('SubCustomer') || [],
      );
      this.validateChargeTypeDimension(arLine, uniqueChargeTypeDims);
      this.validateSalesMan(arLine, dimensionsMap.get('SalesMan') || []);
      this.validateFreightType(arLine, dimensionsMap.get('FreightType') || []);
      this.validateDirection(arLine, dimensionsMap.get('Direction') || []);
      this.validateCoordinatorMan(arLine, dimensionsMap.get('CoordinatorMan') || []);
    }

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
      const invoiceNum = line.freeTextNumber || '';
      if (!invoiceGroups.has(invoiceNum)) {
        invoiceGroups.set(invoiceNum, []);
      }
      invoiceGroups.get(invoiceNum)!.push(line);
    }

    // Process each invoice
    for (const [invoiceNumber, lines] of invoiceGroups.entries()) {
      if (lines.length === 0) continue;

      const firstLine = lines[0];
      const createdInvoice =
        await this.d365FODataService.createCustomerInvoiceHeaderAsync(
          company,
          firstLine,
        );

      for (const line of lines) {
        await this.d365FODataService.createCustomerInvoiceLineAsync(
          company,
          createdInvoice.InvoiceIdentifier || 0,
          line,
        );
      }
    }
  }
}
