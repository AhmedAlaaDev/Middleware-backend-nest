import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { D365FOCustomer } from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatchMissingMasterData } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { CreateCustomerFromMissingDataCommand } from '@/modules/master-data/commands/create-customer-from-missing-data.command';
import { CreateCustomerDto } from '@/modules/master-data/dtos/create-customer.dto';
import {
  ICreateCustomer,
  ICreateCustomerFromMissingDataResult,
  ICustomer,
} from '@/modules/master-data/interfaces/customer.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(CreateCustomerFromMissingDataCommand)
export class CreateCustomerFromMissingDataHandler implements ICommandHandler<CreateCustomerFromMissingDataCommand> {
  private readonly logger = new Logger(
    CreateCustomerFromMissingDataHandler.name,
  );

  constructor(
    private readonly customerService: CustomerService,
    private readonly masterDataService: MasterDataService,
    private readonly dataBatchService: DataBatchService,
    private readonly missingMasterDataRepo: DataBatchMissingMasterDataRepository,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  public async execute(
    command: CreateCustomerFromMissingDataCommand,
  ): Promise<ICreateCustomerFromMissingDataResult> {
    const { missingDataId, dto } = command;
    const missingRecord =
      await this.missingMasterDataRepo.findById(missingDataId);
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

    const batch = await this.dataBatchService.getByIdAsync(
      missingRecord.batchId,
    );
    if (!batch) {
      throw new NotFoundException(
        `Batch with ID ${missingRecord.batchId} not found`,
      );
    }
    if (batch.status !== DataBatchStatus.PendingPosting) {
      throw new ConflictException(
        `Batch must be PendingPosting. Current status is ${batch.status}`,
      );
    }

    this.assertAuthoritativeIdentifiers(missingRecord, dto);

    if (
      missingRecord.creationStatus === 'created' &&
      missingRecord.createdData
    ) {
      return this.finishCreatedCustomer(
        missingRecord,
        missingRecord.createdData as unknown as D365FOCustomer,
      );
    }
    if (missingRecord.creationStatus === 'creating') {
      throw new ConflictException('Customer creation is already in progress');
    }

    const claimed =
      await this.missingMasterDataRepo.claimForCreation(missingDataId);
    if (!claimed) {
      const current = await this.missingMasterDataRepo.findById(missingDataId);
      if (current?.creationStatus === 'created' && current.createdData) {
        return this.finishCreatedCustomer(
          current,
          current.createdData as unknown as D365FOCustomer,
        );
      }
      throw new ConflictException('Customer creation is already in progress');
    }

    const payload = this.buildCustomerPayload(claimed, dto);
    let createdCustomer = await this.findExistingCustomer(claimed);

    if (!createdCustomer) {
      try {
        createdCustomer = await this.customerService.createCustomer(payload);
      } catch (error) {
        createdCustomer = await this.findExistingCustomer(claimed);
        if (!createdCustomer) {
          const message = this.getErrorMessage(error);
          await this.missingMasterDataRepo.updateOne(missingDataId, {
            creationStatus: 'create_failed',
            createErrorMessage: message,
          });
          throw new BadRequestException(
            `Failed to create customer in D365FO: ${message}`,
          );
        }
      }
    }

    if (!this.createdCustomerMatches(claimed, createdCustomer)) {
      const message =
        'D365FO customer does not match the stored missing identifier';
      await this.missingMasterDataRepo.updateOne(missingDataId, {
        creationStatus: 'created',
        reprocessStatus: 'failed',
        createdData: createdCustomer as unknown as Record<string, unknown>,
        createErrorMessage: null,
        reprocessErrorMessage: message,
      });
      throw new ConflictException(message);
    }
    await this.missingMasterDataRepo.updateOne(missingDataId, {
      creationStatus: 'created',
      reprocessStatus: 'pending',
      createdData: createdCustomer as unknown as Record<string, unknown>,
      createErrorMessage: null,
      reprocessErrorMessage: null,
    });

    return this.finishCreatedCustomer(claimed, createdCustomer);
  }

  private async finishCreatedCustomer(
    missingRecord: IDataBatchMissingMasterData,
    createdCustomer: D365FOCustomer,
  ): Promise<ICreateCustomerFromMissingDataResult> {
    const localCustomer = this.mapCustomer(createdCustomer);
    try {
      await Promise.all([
        this.masterDataService.upsertCustomersAsync(missingRecord.company, [
          localCustomer,
        ]),
        this.masterDataService.upsertFinancialDimensionValuesAsync([
          {
            financialDimensionKey: 'Customer',
            value: createdCustomer.CustomerAccount,
            description: createdCustomer.Name,
            isSuspended: 'No',
            isBlockedForManualEntry: 'No',
            isTotal: 'No',
          },
        ]),
      ]);

      if (missingRecord.reprocessStatus === 'succeeded') {
        return {
          customer: this.toCustomer(localCustomer),
          creationStatus: 'created',
          reprocessStatus: 'succeeded',
        };
      }

      await this.dataBatchService.reprocessBatchAsync(
        missingRecord.batchId,
        missingRecord.id,
      );
      return {
        customer: this.toCustomer(localCustomer),
        creationStatus: 'created',
        reprocessStatus: 'succeeded',
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      await this.missingMasterDataRepo.updateOne(missingRecord.id, {
        reprocessStatus: 'failed',
        reprocessErrorMessage: message,
      });
      this.logger.error(
        `Customer ${createdCustomer.CustomerAccount} was created but batch reprocessing failed: ${message}`,
      );
      return {
        customer: this.toCustomer(localCustomer),
        creationStatus: 'created',
        reprocessStatus: 'failed',
        reprocessErrorMessage: message,
      };
    }
  }

  private assertAuthoritativeIdentifiers(
    missingRecord: IDataBatchMissingMasterData,
    dto: CreateCustomerDto,
  ): void {
    if (
      missingRecord.missingField === 'CustomerAccount' &&
      this.normalize(dto.customerAccount) !==
        this.normalize(missingRecord.missingValue)
    ) {
      throw new BadRequestException(
        'Customer account does not match the stored missing identifier',
      );
    }
    if (
      missingRecord.missingField === 'TaxExemptNumber' &&
      dto.taxExemptNumber &&
      this.normalize(dto.taxExemptNumber) !==
        this.normalize(missingRecord.missingValue)
    ) {
      throw new BadRequestException(
        'Tax exempt number does not match the stored missing identifier',
      );
    }
  }

  private buildCustomerPayload(
    missingRecord: IDataBatchMissingMasterData,
    dto: CreateCustomerDto,
  ): Record<string, unknown> {
    return {
      dataAreaId: missingRecord.company,
      CustomerAccount:
        missingRecord.missingField === 'CustomerAccount'
          ? missingRecord.missingValue
          : dto.customerAccount,
      TaxExemptNumber:
        missingRecord.missingField === 'TaxExemptNumber'
          ? missingRecord.missingValue
          : (dto.taxExemptNumber ?? ''),
      Name: dto.name,
      CustomerGroupId: dto.customerGroupId,
      SalesTaxGroup: dto.salesTaxGroup,
      PaymentTerms: dto.paymentTerms,
      PartyType: dto.partyType === 'Personal' ? 'Person' : dto.partyType,
      IsSalesTaxIncludedInPrices: dto.isSalesTaxIncludedInPrices,
      AddressCountryRegionId: 'EGY',
      SalesCurrencyCode: dto.salesCurrencyCode || 'EGP',
    };
  }

  private findExistingCustomer(
    missingRecord: IDataBatchMissingMasterData,
  ): Promise<D365FOCustomer | null> {
    if (missingRecord.missingField === 'CustomerAccount') {
      return this.customerService.getCustomerByAccount(
        missingRecord.company,
        missingRecord.missingValue,
        { useCache: false },
      );
    }
    return this.customerService.getCustomerByTaxExemptNumber(
      missingRecord.company,
      missingRecord.missingValue,
      { useCache: false },
    );
  }

  private createdCustomerMatches(
    missingRecord: IDataBatchMissingMasterData,
    customer: D365FOCustomer,
  ): boolean {
    const actual =
      missingRecord.missingField === 'CustomerAccount'
        ? customer.CustomerAccount
        : customer.TaxExemptNumber;
    return (
      this.normalize(customer.dataAreaId) ===
        this.normalize(missingRecord.company) &&
      this.normalize(actual) === this.normalize(missingRecord.missingValue)
    );
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

  private normalize(value?: string): string {
    return value?.trim().toLowerCase() ?? '';
  }

  private getErrorMessage(error: unknown): string {
    return this.dfoErrorExtractor.extractMessage(error);
  }
}
