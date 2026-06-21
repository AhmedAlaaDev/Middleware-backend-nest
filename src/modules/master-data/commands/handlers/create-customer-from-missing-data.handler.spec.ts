/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { D365FOCustomer } from '@/modules/d365fo/types';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatchMissingMasterData } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { CreateCustomerFromMissingDataCommand } from '@/modules/master-data/commands/create-customer-from-missing-data.command';
import { CreateCustomerFromMissingDataHandler } from '@/modules/master-data/commands/handlers/create-customer-from-missing-data.handler';
import { CreateCustomerDto } from '@/modules/master-data/dtos/create-customer.dto';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

const dto: CreateCustomerDto = {
  customerAccount: 'C-100',
  name: 'Created Customer',
  customerGroupId: 'Domestic',
  salesTaxGroup: 'Taxable',
  paymentTerms: '30 Days',
  partyType: 'Organization',
  isSalesTaxIncludedInPrices: 'No',
  addressCountryRegionId: 'EGY',
  salesCurrencyCode: 'EGP',
  taxExemptNumber: 'TAX-100',
};

const d365Customer: D365FOCustomer = {
  dataAreaId: 'Saco',
  CustomerAccount: 'C-100',
  TaxExemptNumber: 'TAX-100',
  Name: 'Created Customer',
};

function createHarness(overrides?: Partial<IDataBatchMissingMasterData>) {
  let record: IDataBatchMissingMasterData = {
    id: 'missing-1',
    batchId: 'batch-1',
    company: 'Saco',
    entryProcessorType: EntryProcessorTypes.AccountReceivableFreight,
    type: 'customer',
    missingField: 'CustomerAccount',
    missingValue: 'C-100',
    creationStatus: 'missing',
    reprocessStatus: 'not_started',
    affectedCount: 1,
    readonlyFormFields: ['CustomerAccount'],
    reprocessAttempts: 0,
    ...overrides,
  };

  const missingRepo = {
    findById: jest.fn(async () => record),
    claimForCreation: jest.fn(async () => {
      if (!['missing', 'create_failed'].includes(record.creationStatus)) {
        return null;
      }
      record = { ...record, creationStatus: 'creating' };
      return record;
    }),
    updateOne: jest.fn(async (_id: string, update: object) => {
      record = { ...record, ...update };
    }),
  } as unknown as DataBatchMissingMasterDataRepository;
  const customerService = {
    getCustomerByAccount: jest.fn().mockResolvedValue(null),
    getCustomerByTaxExemptNumber: jest.fn().mockResolvedValue(null),
    createCustomer: jest.fn().mockResolvedValue(d365Customer),
  } as unknown as CustomerService;
  const masterDataService = {
    upsertCustomersAsync: jest.fn().mockResolvedValue(undefined),
    upsertFinancialDimensionValuesAsync: jest.fn().mockResolvedValue(undefined),
  } as unknown as MasterDataService;
  const dataBatchService = {
    getByIdAsync: jest.fn().mockResolvedValue({
      id: 'batch-1',
      status: DataBatchStatus.PendingPosting,
    }),
    reprocessBatchAsync: jest
      .fn()
      .mockRejectedValue(new Error('validation failed')),
  } as unknown as DataBatchService;
  const dfoErrorExtractor = {
    extractMessage: jest.fn((err: any) => err instanceof Error ? err.message : String(err)),
    normalize: jest.fn((err: any) => ({ message: err instanceof Error ? err.message : String(err) })),
  } as unknown as DfoErrorExtractorService;

  return {
    handler: new CreateCustomerFromMissingDataHandler(
      customerService,
      masterDataService,
      dataBatchService,
      missingRepo,
      dfoErrorExtractor,
    ),
    customerService,
    dataBatchService,
    masterDataService,
    missingRepo,
    getRecord: () => record,
  };
}

describe(CreateCustomerFromMissingDataHandler.name, () => {
  it('keeps creation successful when reprocessing fails and refreshes both caches', async () => {
    const harness = createHarness();

    const result = await harness.handler.execute(
      new CreateCustomerFromMissingDataCommand('missing-1', dto),
    );

    expect(result).toMatchObject({
      creationStatus: 'created',
      reprocessStatus: 'failed',
      reprocessErrorMessage: 'validation failed',
    });
    expect(harness.getRecord()).toMatchObject({
      creationStatus: 'created',
      reprocessStatus: 'failed',
    });
    expect(
      harness.masterDataService.upsertCustomersAsync,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.masterDataService.upsertFinancialDimensionValuesAsync,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        financialDimensionKey: 'Customer',
        value: 'C-100',
      }),
    ]);
  });

  it('retries reprocessing without posting a duplicate customer', async () => {
    const harness = createHarness();
    const command = new CreateCustomerFromMissingDataCommand('missing-1', dto);

    await harness.handler.execute(command);
    await harness.handler.execute(command);

    expect(harness.customerService.createCustomer).toHaveBeenCalledTimes(1);
    expect(harness.dataBatchService.reprocessBatchAsync).toHaveBeenCalledTimes(
      2,
    );
  });

  it('rejects an editable identifier that differs from the stored record', async () => {
    const harness = createHarness();

    await expect(
      harness.handler.execute(
        new CreateCustomerFromMissingDataCommand('missing-1', {
          ...dto,
          customerAccount: 'DIFFERENT',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.customerService.createCustomer).not.toHaveBeenCalled();
  });
});
