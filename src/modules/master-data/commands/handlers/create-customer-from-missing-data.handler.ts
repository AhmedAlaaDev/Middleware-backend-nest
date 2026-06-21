import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { D365FOCustomer } from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatchMissingMasterData } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { CreateCustomerFromMissingDataCommand } from '@/modules/master-data/commands/create-customer-from-missing-data.command';
import { CreateCustomerDto } from '@/modules/master-data/dtos/create-customer.dto';
import { InlineCustomerError } from '@/modules/master-data/errors/inline-customer.error';
import {
  ICreateCustomer,
  ICreateCustomerFromMissingDataResult,
  ICustomer,
} from '@/modules/master-data/interfaces/customer.interface';
import { InlineCustomerCreationService } from '@/modules/master-data/services/inline-customer-creation.service';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

@CommandHandler(CreateCustomerFromMissingDataCommand)
export class CreateCustomerFromMissingDataHandler implements ICommandHandler<CreateCustomerFromMissingDataCommand> {
  constructor(
    private readonly inlineCreation: InlineCustomerCreationService,
    private readonly masterData: MasterDataService,
    private readonly batches: DataBatchService,
    private readonly missingRecords: DataBatchMissingMasterDataRepository,
    private readonly logs: OperationalLoggerService,
  ) {}

  public async execute(
    command: CreateCustomerFromMissingDataCommand,
  ): Promise<ICreateCustomerFromMissingDataResult> {
    const missingRecord = await this.requireMissingRecord(
      command.missingDataId,
    );
    await this.requireEditableBatch(missingRecord.batchId);
    this.assertAuthoritativeIdentifiers(missingRecord, command.dto);

    if (missingRecord.creationStatus === 'creating') {
      throw new ConflictException('Customer creation is already in progress');
    }
    if (
      missingRecord.creationStatus === 'created' &&
      missingRecord.createdData
    ) {
      return this.finishLocalPersistence(
        missingRecord,
        missingRecord.createdData as unknown as D365FOCustomer,
      );
    }

    const claimed = await this.missingRecords.claimForCreation(
      command.missingDataId,
    );
    if (!claimed) {
      throw new ConflictException('Customer creation is already in progress');
    }

    try {
      const customer = await this.inlineCreation.create(
        this.creationInput(claimed, command.dto),
      );
      await this.markCustomerCreated(claimed.id, customer);
      return this.finishLocalPersistence(claimed, customer);
    } catch (error) {
      await this.markCreationFailure(claimed.id, error);
      throw error;
    }
  }

  private async requireMissingRecord(
    missingDataId: string,
  ): Promise<IDataBatchMissingMasterData> {
    const missingRecord = await this.missingRecords.findById(missingDataId);
    if (!missingRecord) {
      throw new NotFoundException(
        `Missing master data record with ID ${missingDataId} not found`,
      );
    }
    if (missingRecord.type !== 'customer') {
      throw new BadRequestException(
        'Missing master data record is not a customer',
      );
    }
    return missingRecord;
  }

  private async requireEditableBatch(batchId: string): Promise<void> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    if (batch.status !== DataBatchStatus.PendingPosting) {
      throw new ConflictException(
        `Batch must be PendingPosting. Current status is ${batch.status}`,
      );
    }
  }

  private creationInput(
    missingRecord: IDataBatchMissingMasterData,
    dto: CreateCustomerDto,
  ) {
    const customerAccount =
      missingRecord.missingField === 'CustomerAccount'
        ? missingRecord.missingValue
        : dto.customerAccount;
    const taxExemptNumber =
      missingRecord.missingField === 'TaxExemptNumber'
        ? missingRecord.missingValue
        : dto.taxExemptNumber;
    return {
      missingDataId: missingRecord.id,
      batchId: missingRecord.batchId,
      dataAreaId: missingRecord.company,
      customerAccount,
      taxExemptNumber,
      customerName: dto.name,
      customerGroupId: dto.customerGroupId,
      partyType: dto.partyType,
      salesTaxGroup: dto.salesTaxGroup,
      isSalesTaxIncludedInPrices: dto.isSalesTaxIncludedInPrices as
        | 'Yes'
        | 'No',
      paymentTerms: dto.paymentTerms,
      addressCountryRegionId: dto.addressCountryRegionId,
      salesCurrencyCode: dto.salesCurrencyCode,
      existingCustomerPolicy:
        missingRecord.creationStatus === 'create_failed'
          ? ('adopt-exact-match' as const)
          : ('conflict' as const),
    };
  }

  private async markCustomerCreated(
    missingDataId: string,
    customer: D365FOCustomer,
  ): Promise<void> {
    await this.missingRecords.updateOne(missingDataId, {
      creationStatus: 'created',
      reprocessStatus: 'pending',
      createdData: customer as unknown as Record<string, unknown>,
      createErrorMessage: null,
      reprocessErrorMessage: null,
    });
  }

  private async finishLocalPersistence(
    missingRecord: IDataBatchMissingMasterData,
    customer: D365FOCustomer,
  ): Promise<ICreateCustomerFromMissingDataResult> {
    const localCustomer = this.mapCustomer(customer);
    try {
      await Promise.all([
        this.masterData.upsertCustomersAsync(missingRecord.company, [
          localCustomer,
        ]),
        this.masterData.upsertFinancialDimensionValuesAsync([
          {
            financialDimensionKey: 'Customer',
            value: customer.CustomerAccount,
            description: customer.Name,
            isSuspended: 'No',
            isBlockedForManualEntry: 'No',
            isTotal: 'No',
          },
        ]),
      ]);
      await this.emitLocalUpdate(missingRecord, customer, 'completed');
      return {
        customer: this.toCustomer(localCustomer),
        creationStatus: 'created',
        reprocessStatus: 'pending',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.missingRecords.updateOne(missingRecord.id, {
        creationStatus: 'created',
        reprocessStatus: 'pending',
        createErrorMessage: message,
      });
      await this.emitLocalUpdate(missingRecord, customer, 'failed', message);
      throw new InlineCustomerError(
        'REMEDIATION_UPDATE_FAILED_AFTER_CUSTOMER_CREATED',
        'Customer was created but the local remediation update failed. Resolve local state and retry manually.',
        {
          dataAreaId: missingRecord.company,
          customerAccount: customer.CustomerAccount,
          taxExemptNumber: customer.TaxExemptNumber,
          action: 'update local remediation data',
          dfoInnerMessage: message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async markCreationFailure(
    missingDataId: string,
    error: unknown,
  ): Promise<void> {
    const current = await this.missingRecords.findById(missingDataId);
    if (current?.creationStatus === 'created') return;
    const response =
      error instanceof InlineCustomerError
        ? (error.getResponse() as { message: string })
        : undefined;
    await this.missingRecords.updateOne(missingDataId, {
      creationStatus: 'create_failed',
      createErrorMessage:
        response?.message ??
        (error instanceof Error ? error.message : String(error)),
    });
  }

  private assertAuthoritativeIdentifiers(
    missingRecord: IDataBatchMissingMasterData,
    dto: CreateCustomerDto,
  ): void {
    const normalize = (part?: string) => part?.trim().toLowerCase() ?? '';
    if (
      missingRecord.missingField === 'CustomerAccount' &&
      normalize(dto.customerAccount) !== normalize(missingRecord.missingValue)
    ) {
      throw new BadRequestException(
        'Customer account does not match the stored missing identifier',
      );
    }
    if (
      missingRecord.missingField === 'TaxExemptNumber' &&
      normalize(dto.taxExemptNumber) !== normalize(missingRecord.missingValue)
    ) {
      throw new BadRequestException(
        'Tax exempt number does not match the stored missing identifier',
      );
    }
  }

  private mapCustomer(customer: D365FOCustomer): ICreateCustomer {
    return {
      company: customer.dataAreaId,
      customerAccount: customer.CustomerAccount,
      name: customer.Name,
      organizationPhoneticName: customer.OrganizationPhoneticName,
      nameAlias: customer.NameAlias || customer.Name,
      customerGroupId: customer.CustomerGroupId,
      salesCurrencyCode: customer.SalesCurrencyCode,
      invoiceAccount: customer.InvoiceAccount,
      partyNumber: customer.PartyNumber,
      organizationNumber: customer.OrganizationNumber,
      taxExemptNumber: customer.TaxExemptNumber,
      defaultDimensionDisplayValue: customer.DefaultDimensionDisplayValue,
    };
  }

  private toCustomer(customer: ICreateCustomer): ICustomer {
    return { id: '', ...customer };
  }

  private emitLocalUpdate(
    missingRecord: IDataBatchMissingMasterData,
    customer: D365FOCustomer,
    status: 'completed' | 'failed',
    error?: string,
  ): Promise<void> {
    return this.logs.emit({
      level: status === 'failed' ? 'error' : 'info',
      message: `Inline customer local remediation update ${status}`,
      context: CreateCustomerFromMissingDataHandler.name,
      eventType: 'inline_customer.local_update',
      status,
      batchId: missingRecord.batchId,
      error: error ? { message: error } : undefined,
      metadata: {
        missingDataId: missingRecord.id,
        customerAccount: customer.CustomerAccount,
        ...(customer.TaxExemptNumber
          ? { taxExemptNumber: customer.TaxExemptNumber }
          : {}),
      },
    });
  }
}
