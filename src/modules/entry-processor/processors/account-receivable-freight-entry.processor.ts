import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { CustomerInvoiceService } from '@/modules/d365fo/services/customer-invoice.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DBService } from '@/modules/db/db.service';
import {
  DynDataModel,
  RawDataModel,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountReceivableFileModel } from '@/modules/entry-processor/models/account-receivable-file.model';
import { DynAccountReceivableLineDto } from '@/modules/entry-processor/models/dyn-account-receivable-line.dto';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IFinancialDimensionValue } from '@/modules/master-data/interfaces/financial-dimension.interface';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';

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
      ServiceTypes.Freight,
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

    const billingCodes = await this.queryBus.execute(
      new GetBillingCodesQuery(company),
    );

    if (billingClassId) {
      this.billingClassifications.set(billingClassId, billingCodes);
    }

    for (const [_key, lines] of invoiceGroups.entries()) {
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
          // Preparing the Account Dims
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

          line.ACCOUNTDISPLAYVALUE =
            this.convertToStringDimensions(accountDimensions);
          //Get the Dims Billing code
          const billingCode =
            billingCodes.find((bc: any) =>
              bc.billingCode
                ?.toLowerCase()
                .includes(accountDimensions.chargeType?.toLowerCase() || ''),
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
    if (billingClassId) {
      const billingCodes =
        this.billingClassifications.get(billingClassId) || [];
      chargeTypeDims.push(
        ...billingCodes.map((bc) => bc.billingCode).filter((bc) => bc),
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
}
