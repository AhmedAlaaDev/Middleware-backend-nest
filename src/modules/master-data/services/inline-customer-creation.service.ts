import { HttpStatus, Injectable } from '@nestjs/common';

import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import {
  CreateCustomerInput,
  CustomerService,
} from '@/modules/d365fo/services/customer.service';
import { VatNumTableService } from '@/modules/d365fo/services/vat-num-table.service';
import { D365FOCustomer, VatNumTableRecord } from '@/modules/d365fo/types';
import { InlineCustomerError } from '@/modules/master-data/errors/inline-customer.error';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

export interface InlineCustomerCreationInput {
  missingDataId: string;
  batchId: string;
  dataAreaId: string;
  customerAccount: string;
  taxExemptNumber?: string;
  customerName: string;
  customerGroupId: string;
  partyType: string;
  salesTaxGroup: string;
  isSalesTaxIncludedInPrices: 'Yes' | 'No';
  paymentTerms: string;
  addressCountryRegionId: string;
  salesCurrencyCode: string;
  existingCustomerPolicy: 'conflict' | 'adopt-exact-match';
}

@Injectable()
export class InlineCustomerCreationService {
  constructor(
    private readonly customers: CustomerService,
    private readonly vatNumbers: VatNumTableService,
    private readonly logs: OperationalLoggerService,
  ) {}

  public async create(
    rawInput: InlineCustomerCreationInput,
  ): Promise<D365FOCustomer> {
    const input = this.normalizedInput(rawInput);
    await this.emit('inline_customer.start', 'started', input);
    const existingByAccount = await this.customers.getCustomerByAccount(
      input.dataAreaId,
      input.customerAccount,
      { useCache: false },
    );
    await this.emitLookup('customer_account', existingByAccount, input);

    if (existingByAccount) {
      return this.resolveExistingAccount(existingByAccount, input);
    }

    if (input.taxExemptNumber) {
      await this.assertTaxNumberAvailable(input);
      return this.createWithVatPreparation(input);
    }
    return this.createCustomer(input);
  }

  private normalizedInput(
    input: InlineCustomerCreationInput,
  ): InlineCustomerCreationInput {
    const normalized = {
      ...input,
      dataAreaId: input.dataAreaId.trim(),
      customerAccount: input.customerAccount.trim(),
      taxExemptNumber: input.taxExemptNumber?.trim() || undefined,
      customerName: input.customerName.trim(),
      addressCountryRegionId: input.addressCountryRegionId.trim(),
      salesCurrencyCode: input.salesCurrencyCode.trim(),
    };
    this.assertRequiredInput(normalized);
    return normalized;
  }

  private assertRequiredInput(input: InlineCustomerCreationInput): void {
    const missingField = [
      ['dataAreaId', input.dataAreaId],
      ['customerAccount', input.customerAccount],
      ['customerName', input.customerName],
      ['addressCountryRegionId', input.addressCountryRegionId],
      ['salesCurrencyCode', input.salesCurrencyCode],
      ['customerGroupId', input.customerGroupId],
      ['salesTaxGroup', input.salesTaxGroup],
      ['paymentTerms', input.paymentTerms],
      ['partyType', input.partyType],
    ].find(([, fieldValue]) => !fieldValue);
    if (!missingField) return;
    throw new InlineCustomerError(
      'DFO_VALIDATION_FAILED',
      `${missingField[0]} is required for customer creation.`,
      this.context(input),
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private resolveExistingAccount(
    customer: D365FOCustomer,
    input: InlineCustomerCreationInput,
  ): D365FOCustomer {
    if (
      input.existingCustomerPolicy === 'adopt-exact-match' &&
      this.isExactMatch(customer, input)
    ) {
      return customer;
    }
    throw new InlineCustomerError(
      'CUSTOMER_ACCOUNT_ALREADY_EXISTS',
      `Customer account "${input.customerAccount}" already exists in company "${input.dataAreaId}".`,
      {
        ...this.context(input),
        existingCustomerAccount: customer.CustomerAccount,
        existingCustomerName: customer.Name,
        action: 'find customer by account',
        endpoint: '/data/Customers',
      },
      HttpStatus.CONFLICT,
    );
  }

  private async assertTaxNumberAvailable(
    input: InlineCustomerCreationInput,
  ): Promise<void> {
    const customer = await this.customers.getCustomerByTaxExemptNumber(
      input.dataAreaId,
      input.taxExemptNumber!,
      { useCache: false },
    );
    await this.emitLookup('tax_number_customer', customer, input);
    if (!customer) return;
    throw new InlineCustomerError(
      'TAX_NUMBER_ALREADY_LINKED_TO_CUSTOMER',
      `Tax number "${input.taxExemptNumber}" is already linked to customer "${customer.CustomerAccount}" - "${customer.Name ?? ''}" in company "${input.dataAreaId}".`,
      {
        ...this.context(input),
        existingCustomerAccount: customer.CustomerAccount,
        existingCustomerName: customer.Name,
        action: 'find customer by tax number',
        endpoint: '/data/Customers',
      },
      HttpStatus.CONFLICT,
    );
  }

  private async createWithVatPreparation(
    input: InlineCustomerCreationInput,
  ): Promise<D365FOCustomer> {
    const vatRecords = await this.vatNumbers.findVatNums(
      input.dataAreaId,
      input.taxExemptNumber!,
    );
    await this.emitVatLookup(vatRecords, input);
    const matchingVat = vatRecords.find(
      (record) =>
        record.CountryRegionId.toLowerCase() ===
        input.addressCountryRegionId.toLowerCase(),
    );
    if (matchingVat) return this.createCustomer(input);
    if (vatRecords.length)
      this.throwCountryRegionMismatch(vatRecords[0], input);

    const preparedVat = await this.createVatNumber(input);
    try {
      return await this.createCustomer(input);
    } catch (customerError) {
      if (preparedVat.createdByThisFlow) {
        await this.rollbackVatNumber(preparedVat.record, input, customerError);
      }
      throw customerError;
    }
  }

  private throwCountryRegionMismatch(
    vatRecord: VatNumTableRecord,
    input: InlineCustomerCreationInput,
  ): never {
    throw new InlineCustomerError(
      'TAX_NUMBER_COUNTRY_REGION_MISMATCH',
      `Tax number "${input.taxExemptNumber}" already exists in VATNumTables for country/region "${vatRecord.CountryRegionId}", but the selected customer country/region is "${input.addressCountryRegionId}".`,
      {
        ...this.context(input),
        existingCountryRegionId: vatRecord.CountryRegionId,
        requestedCountryRegionId: input.addressCountryRegionId,
        action: 'validate VAT country/region',
        endpoint: '/data/VATNumTables',
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private async createVatNumber(input: InlineCustomerCreationInput): Promise<{
    record: VatNumTableRecord;
    createdByThisFlow: boolean;
  }> {
    await this.emit('inline_customer.vat_create', 'started', input);
    try {
      const vatRecord = await this.vatNumbers.createVatNum({
        dataAreaId: input.dataAreaId,
        VATNum: input.taxExemptNumber!,
        CountryRegionId: input.addressCountryRegionId,
        Name: input.customerName,
      });
      await this.emit('inline_customer.vat_create', 'completed', input);
      return { record: vatRecord, createdByThisFlow: true };
    } catch (error) {
      const concurrentRecords = await this.vatNumbers.findVatNums(
        input.dataAreaId,
        input.taxExemptNumber!,
      );
      const concurrentMatch = concurrentRecords.find(
        (record) =>
          record.CountryRegionId.toLowerCase() ===
          input.addressCountryRegionId.toLowerCase(),
      );
      if (concurrentMatch) {
        return { record: concurrentMatch, createdByThisFlow: false };
      }
      throw this.dfoFailure({
        code: 'VAT_NUMBER_CREATE_FAILED',
        message: 'Failed to create VAT number setup in D365FO.',
        endpoint: '/data/VATNumTables',
        action: 'create VAT number',
        input,
        error,
      });
    }
  }

  private async createCustomer(
    input: InlineCustomerCreationInput,
  ): Promise<D365FOCustomer> {
    await this.emit('inline_customer.customer_create', 'started', input);
    try {
      const customer = await this.customers.createCustomer(
        this.customerPayload(input),
      );
      await this.emit('inline_customer.customer_create', 'completed', input);
      return customer;
    } catch (error) {
      const existingCustomer = await this.customers.getCustomerByAccount(
        input.dataAreaId,
        input.customerAccount,
        { useCache: false },
      );
      if (existingCustomer && this.isExactMatch(existingCustomer, input)) {
        await this.emit('inline_customer.customer_create', 'completed', input, {
          recoveredAfterUncertainResponse: true,
        });
        return existingCustomer;
      }
      throw this.dfoFailure({
        code: 'CUSTOMER_CREATE_FAILED',
        message: 'Failed to create customer in D365FO.',
        endpoint: '/data/Customers',
        action: 'create customer',
        input,
        error,
      });
    }
  }

  private async rollbackVatNumber(
    vatRecord: VatNumTableRecord,
    input: InlineCustomerCreationInput,
    customerError: unknown,
  ): Promise<void> {
    await this.emit('inline_customer.vat_rollback', 'started', input);
    try {
      await this.vatNumbers.deleteVatNum(
        vatRecord.dataAreaId,
        vatRecord.VATNum,
        vatRecord.CountryRegionId,
      );
      this.addRollback(customerError, true);
      await this.emit('inline_customer.vat_rollback', 'completed', input);
    } catch (rollbackError) {
      const message = dfoErrorMessage(rollbackError);
      this.addRollback(customerError, false, message);
      await this.emit('inline_customer.vat_rollback', 'failed', input, {
        rollbackError: message,
      });
    }
  }

  private customerPayload(
    input: InlineCustomerCreationInput,
  ): CreateCustomerInput {
    return {
      PartyType: input.partyType === 'Personal' ? 'Person' : input.partyType,
      dataAreaId: input.dataAreaId,
      SalesTaxGroup: input.salesTaxGroup,
      Name: input.customerName,
      CustomerGroupId: input.customerGroupId,
      SalesCurrencyCode: input.salesCurrencyCode,
      CustomerAccount: input.customerAccount,
      ...(input.taxExemptNumber
        ? { TaxExemptNumber: input.taxExemptNumber }
        : {}),
      OrganizationNumber: '',
      PaymentTerms: input.paymentTerms,
      AddressCountryRegionId: input.addressCountryRegionId,
      IsSalesTaxIncludedInPrices: input.isSalesTaxIncludedInPrices,
    };
  }

  private isExactMatch(
    customer: D365FOCustomer,
    input: InlineCustomerCreationInput,
  ): boolean {
    const normalize = (part?: string) => part?.trim().toLowerCase() ?? '';
    return (
      normalize(customer.dataAreaId) === normalize(input.dataAreaId) &&
      normalize(customer.CustomerAccount) ===
        normalize(input.customerAccount) &&
      normalize(customer.TaxExemptNumber) === normalize(input.taxExemptNumber)
    );
  }

  private dfoFailure(failure: {
    code: 'VAT_NUMBER_CREATE_FAILED' | 'CUSTOMER_CREATE_FAILED';
    message: string;
    endpoint: string;
    action: string;
    input: InlineCustomerCreationInput;
    error: unknown;
  }): InlineCustomerError {
    return new InlineCustomerError(failure.code, failure.message, {
      ...this.context(failure.input),
      endpoint: failure.endpoint,
      action: failure.action,
      dfoInnerMessage: dfoErrorMessage(failure.error),
    });
  }

  private addRollback(
    error: unknown,
    succeeded: boolean,
    message?: string,
  ): void {
    if (!(error instanceof InlineCustomerError)) return;
    const response = error.getResponse() as {
      details: Record<string, unknown>;
    };
    response.details.rollback = { attempted: true, succeeded, message };
  }

  private context(input: InlineCustomerCreationInput) {
    return {
      dataAreaId: input.dataAreaId,
      customerAccount: input.customerAccount,
      taxExemptNumber: input.taxExemptNumber,
      addressCountryRegionId: input.addressCountryRegionId,
    };
  }

  private emitLookup(
    lookup: string,
    customer: D365FOCustomer | null,
    input: InlineCustomerCreationInput,
  ): Promise<void> {
    return this.emit(`inline_customer.${lookup}_lookup`, 'completed', input, {
      found: Boolean(customer),
      existingCustomerAccount: customer?.CustomerAccount,
    });
  }

  private emitVatLookup(
    records: VatNumTableRecord[],
    input: InlineCustomerCreationInput,
  ): Promise<void> {
    return this.emit('inline_customer.vat_lookup', 'completed', input, {
      found: records.length > 0,
      countryRegions: records.map((record) => record.CountryRegionId),
    });
  }

  private emit(
    eventType: string,
    status: string,
    input: InlineCustomerCreationInput,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.logs.emit({
      level: status === 'failed' ? 'error' : 'info',
      message: `Inline customer creation ${status}`,
      context: InlineCustomerCreationService.name,
      eventType,
      status,
      batchId: input.batchId,
      metadata: {
        missingDataId: input.missingDataId,
        dataAreaId: input.dataAreaId,
        customerAccount: input.customerAccount,
        ...(input.taxExemptNumber
          ? { taxExemptNumber: input.taxExemptNumber }
          : {}),
        addressCountryRegionId: input.addressCountryRegionId,
        ...metadata,
      },
    });
  }
}
